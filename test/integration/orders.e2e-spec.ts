import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Orders (chat + tracking) against real MySQL/Redis: opening the seller chat
 * from an order, sending a customer message, the status-derived tracking
 * timeline, order cancellation, and per-user ownership isolation.
 *
 * Everything here hangs off an order placed against a listing — the only kind
 * of order there is. The chat itself is the buyer–seller conversation, which
 * the order screen finds through /chat/order/:id/contact.
 */
describe('Orders — chat & tracking (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;
  let orderId: string;

  beforeAll(async () => {
    [mysql, redis] = await Promise.all([
      new MySqlContainer('mysql:8.4').start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = mysql.getConnectionUri();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.JWT_ACCESS_SECRET = 'integration-test-secret-with-enough-entropy-123456';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.LOG_LEVEL = 'warn';

    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' });
    execSync('npx prisma db seed', { env: process.env, stdio: 'inherit' });

    const { AppModule } = await import('@/app.module');
    const { configureApp } = await import('@/app.setup');
    const { AuthService } = await import('@/modules/auth/auth.service');
    const { PRISMA } = await import('@/database/prisma.constants');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    const prisma = app.get<import('@/database/prisma.extension').ExtendedPrismaClient>(PRISMA);
    const auth = app.get(AuthService);

    const [user, admin, order] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
      prisma.adOrder.findUnique({ where: { code: 'ELK-A-SEED1' } }),
    ]);
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
    orderId = order!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  let sellerId: string;

  it('opens the seeded buyer–seller chat from the order, with 3 messages', async () => {
    const contact = await request(http())
      .get(`/api/v1/chat/order/${orderId}/contact`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    sellerId = contact.body.data.contactId;

    const res = await request(http())
      .get(`/api/v1/chat/threads/${sellerId}`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    const thread = res.body.data;
    expect(thread).toMatchObject({
      contactName: 'Demo Seller',
      contactStatus: 'Tap to view profile',
    });
    expect(thread.contactInitials).toHaveLength(2);
    expect(thread.messages).toHaveLength(3);
    // The seller's messages are incoming with initials; the buyer's are outgoing without.
    expect(thread.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isOutgoing: false, senderInitials: expect.any(String) }),
        expect.objectContaining({ isOutgoing: true, senderInitials: null }),
      ]),
    );
  });

  it('sends a customer message that persists as outgoing', async () => {
    const send = await request(http())
      .post(`/api/v1/chat/threads/${sellerId}`)
      .set('Authorization', bearer(userToken))
      .send({ text: 'Please call when you arrive' })
      .expect(201);
    expect(send.body.data).toMatchObject({ isOutgoing: true, senderInitials: null });

    const thread = await request(http())
      .get(`/api/v1/chat/threads/${sellerId}`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(thread.body.data.messages).toHaveLength(4);
    expect(thread.body.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Please call when you arrive', isOutgoing: true }),
      ]),
    );
  });

  it('serves a CONFIRMED tracking timeline', async () => {
    const res = await request(http())
      .get(`/api/v1/orders/${orderId}/tracking`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toMatchObject({
      orderId: 'ELK-A-SEED1',
      serviceName: 'Deep Home Cleaning',
      serviceIcon: '🧹',
      statusLabel: 'Work under way',
    });
    // Four steps, not five: an ad order has no dispatch leg.
    expect(res.body.data.steps).toHaveLength(4);
    expect(res.body.data.steps.map((s: { status: string }) => s.status)).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    // The buyer picked the address on the map, so the screen gets a pin.
    expect(res.body.data.lat).toBeCloseTo(12.9352);
    expect(res.body.data.lng).toBeCloseTo(77.6245);
  });

  it("keeps another user out of the order's chat, tracking and cancel", async () => {
    await request(http())
      .get(`/api/v1/chat/order/${orderId}/contact`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
    await request(http())
      .get(`/api/v1/orders/${orderId}/tracking`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
    // Cancel goes through the marketplace's status rules, which answer 403.
    await request(http())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', bearer(adminToken))
      .expect(403);
  });

  it('refuses a buyer cancel once the seller has started work', async () => {
    // The seeded order is IN_PROGRESS. Sharing the marketplace's transition
    // rules is what stops this endpoint undoing work already under way.
    await request(http())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);
  });

  it('cancels an order the seller has not started, then blocks re-cancel', async () => {
    const prisma = app.get<import('@/database/prisma.extension').ExtendedPrismaClient>(
      (await import('@/database/prisma.constants')).PRISMA,
    );
    const fresh = await prisma.adOrder.findUnique({ where: { code: 'ELK-A-SEED1' } });
    await prisma.adOrder.update({ where: { id: fresh!.id }, data: { status: 'NEW' } });

    await request(http())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    const tracking = await request(http())
      .get(`/api/v1/orders/${orderId}/tracking`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(tracking.body.data.statusLabel).toBe('Order cancelled');

    await request(http())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);
  });

  it('requires auth on every route', async () => {
    await request(http()).get(`/api/v1/chat/order/${orderId}/contact`).expect(401);
    await request(http()).get(`/api/v1/orders/${orderId}/tracking`).expect(401);
    await request(http()).post(`/api/v1/orders/${orderId}/cancel`).expect(401);
  });
});
