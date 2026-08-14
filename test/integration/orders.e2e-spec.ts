import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Orders (chat + tracking) against real MySQL/Redis: the seeded seller chat
 * thread, sending a customer message, the status-derived tracking timeline,
 * order cancellation, and per-user ownership isolation.
 *
 * Everything here hangs off an order placed against a listing — the only kind
 * of order there is.
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

  it('serves the seeded chat thread with seller contact + 3 messages', async () => {
    const res = await request(http())
      .get(`/api/v1/orders/${orderId}/chat`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    const thread = res.body.data;
    expect(thread).toMatchObject({
      contactName: 'Demo Provider',
      contactStatus: '● Online · Service Provider',
    });
    expect(thread.contactInitials).toHaveLength(2);
    expect(thread.messages).toHaveLength(3);
    // first is a seller message → incoming with initials
    expect(thread.messages[0]).toMatchObject({ isOutgoing: false });
    expect(thread.messages[0].senderInitials).not.toBeNull();
    // second is the customer → outgoing, no initials
    expect(thread.messages[1]).toMatchObject({ isOutgoing: true, senderInitials: null });
  });

  it('sends a customer message that persists as outgoing', async () => {
    const send = await request(http())
      .post(`/api/v1/orders/${orderId}/chat`)
      .set('Authorization', bearer(userToken))
      .send({ text: 'Please call when you arrive' })
      .expect(201);
    expect(send.body.data).toMatchObject({ isOutgoing: true, senderInitials: null });

    const thread = await request(http())
      .get(`/api/v1/orders/${orderId}/chat`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(thread.body.data.messages).toHaveLength(4);
    expect(thread.body.data.messages[3]).toMatchObject({
      text: 'Please call when you arrive',
      isOutgoing: true,
    });
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

  it("404s another user's order for chat, tracking, and cancel", async () => {
    await request(http())
      .get(`/api/v1/orders/${orderId}/chat`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
    await request(http())
      .get(`/api/v1/orders/${orderId}/tracking`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
    await request(http())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
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
    await request(http()).get(`/api/v1/orders/${orderId}/chat`).expect(401);
    await request(http()).get(`/api/v1/orders/${orderId}/tracking`).expect(401);
    await request(http()).post(`/api/v1/orders/${orderId}/cancel`).expect(401);
  });
});
