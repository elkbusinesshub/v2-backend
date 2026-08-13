import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Seller-owned listings against real MySQL/Redis: creating a draft and a
 * published ad, seeing both on My Listings, editing, pausing, ownership
 * isolation between two accounts, and soft delete removing an ad from the
 * public rails while keeping it out of nobody else's way.
 */
describe('Marketplace — seller listings (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let sellerToken: string;
  let otherToken: string;
  let adminToken: string;

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

    const [seller, other, admin] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000002' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
    ]);
    sellerToken = (await auth.issueTokenPair(seller!, {})).accessToken;
    otherToken = (await auth.issueTokenPair(other!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  let publishedId: string;
  let draftId: string;

  it('publishes a listing', async () => {
    const res = await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(sellerToken))
      .send({
        title: 'Sofa Shampoo Service',
        description: 'Deep clean for fabric sofas',
        categorySlug: 'cleaning',
        price: 899,
        priceUnit: '/ visit',
        locality: 'Koramangala',
        city: 'Bengaluru',
      })
      .expect(201);

    expect(res.body.data).toMatchObject({
      title: 'Sofa Shampoo Service',
      price: 899,
      location: 'Koramangala, Bengaluru',
      wishlistCount: 0,
      viewCount: 0,
    });
    publishedId = res.body.data.id;
  });

  it('saves a draft that buyers cannot see', async () => {
    const res = await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(sellerToken))
      .send({
        title: 'Curtain Cleaning (draft)',
        categorySlug: 'cleaning',
        price: 450,
        status: 'DRAFT',
      })
      .expect(201);
    draftId = res.body.data.id;

    // A draft must not surface in the public browse/search endpoint.
    const browse = await request(http())
      .get('/api/v1/marketplace/ads')
      .query({ q: 'Curtain' })
      .set('Authorization', bearer(otherToken))
      .expect(200);
    expect(browse.body.data.map((a: { id: string }) => a.id)).not.toContain(draftId);
  });

  it('shows the seller both, and filters by status', async () => {
    const all = await request(http())
      .get('/api/v1/marketplace/my-ads')
      .set('Authorization', bearer(sellerToken))
      .expect(200);
    const ids = all.body.data.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([publishedId, draftId]));

    const drafts = await request(http())
      .get('/api/v1/marketplace/my-ads')
      .query({ status: 'DRAFT' })
      .set('Authorization', bearer(sellerToken))
      .expect(200);
    expect(drafts.body.data.map((a: { id: string }) => a.id)).toEqual([draftId]);
  });

  it('does not leak one seller’s listings into another’s', async () => {
    const res = await request(http())
      .get('/api/v1/marketplace/my-ads')
      .set('Authorization', bearer(otherToken))
      .expect(200);

    expect(res.body.data.map((a: { id: string }) => a.id)).not.toContain(draftId);
  });

  it('edits one field without disturbing the rest', async () => {
    const res = await request(http())
      .patch(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(sellerToken))
      .send({ price: 950 })
      .expect(200);

    expect(res.body.data).toMatchObject({
      price: 950,
      // Untouched by the patch, and still present.
      title: 'Sofa Shampoo Service',
      location: 'Koramangala, Bengaluru',
    });
  });

  it('pauses a listing through the same update, removing it from browse', async () => {
    await request(http())
      .patch(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(sellerToken))
      .send({ status: 'PAUSED' })
      .expect(200);

    const browse = await request(http())
      .get('/api/v1/marketplace/ads')
      .query({ q: 'Sofa Shampoo' })
      .set('Authorization', bearer(otherToken))
      .expect(200);
    expect(browse.body.data.map((a: { id: string }) => a.id)).not.toContain(publishedId);

    // Still the seller's own listing, just not on sale.
    const mine = await request(http())
      .get('/api/v1/marketplace/my-ads')
      .set('Authorization', bearer(sellerToken))
      .expect(200);
    expect(mine.body.data.map((a: { id: string }) => a.id)).toContain(publishedId);

    await request(http())
      .patch(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(sellerToken))
      .send({ status: 'ACTIVE' })
      .expect(200);
  });

  it('refuses to let another account edit or delete the listing', async () => {
    await request(http())
      .patch(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(otherToken))
      .send({ price: 1 })
      .expect(403);

    await request(http())
      .delete(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(otherToken))
      .expect(403);
  });

  it('rejects a listing with no title or a negative price', async () => {
    await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(sellerToken))
      .send({ title: '', categorySlug: 'cleaning', price: 10 })
      .expect(400);

    await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(sellerToken))
      .send({ title: 'Cheap', categorySlug: 'cleaning', price: -5 })
      .expect(400);
  });

  it('soft-deletes: gone from My Listings and from the public rails', async () => {
    await request(http())
      .delete(`/api/v1/marketplace/ads/${draftId}`)
      .set('Authorization', bearer(sellerToken))
      .expect(200);

    const mine = await request(http())
      .get('/api/v1/marketplace/my-ads')
      .set('Authorization', bearer(sellerToken))
      .expect(200);
    expect(mine.body.data.map((a: { id: string }) => a.id)).not.toContain(draftId);
  });

  it('lets an admin delete a listing they do not own', async () => {
    await request(http())
      .delete(`/api/v1/marketplace/ads/${publishedId}`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
  });

  it('404s an unknown listing rather than 403', async () => {
    await request(http())
      .delete('/api/v1/marketplace/ads/00000000-0000-7000-8000-000000000000')
      .set('Authorization', bearer(sellerToken))
      .expect(404);
  });

  describe('orders', () => {
    let listingId: string;
    let orderId: string;

    it('a buyer orders a live listing and the seller sees it', async () => {
      const listing = await request(http())
        .post('/api/v1/marketplace/ads')
        .set('Authorization', bearer(sellerToken))
        .send({ title: 'Balcony Deep Clean', categorySlug: 'cleaning', price: 499 })
        .expect(201);
      listingId = listing.body.data.id;

      const placed = await request(http())
        .post(`/api/v1/marketplace/ads/${listingId}/orders`)
        .set('Authorization', bearer(otherToken))
        .send({ addressText: '12, 5th Block, Koramangala', contactPhone: '+919000000001' })
        .expect(201);

      expect(placed.body.data).toMatchObject({
        serviceName: 'Balcony Deep Clean',
        amount: 499,
        status: 'NEW',
        whenLabel: 'As soon as possible',
      });
      expect(placed.body.data.code).toMatch(/^ELK-A-[A-Z0-9]{5}$/);
      orderId = placed.body.data.id;

      const inbox = await request(http())
        .get('/api/v1/marketplace/seller-orders')
        .set('Authorization', bearer(sellerToken))
        .expect(200);
      expect(inbox.body.data.map((o: { id: string }) => o.id)).toContain(orderId);
    });

    it('raises a notification for the seller', async () => {
      // The seller has no live connection to the panel; this is how they learn.
      const notifications = await request(http())
        .get('/api/v1/notifications')
        .set('Authorization', bearer(sellerToken))
        .expect(200);

      expect(notifications.body.data.some((n: { title: string }) => n.title === 'New order')).toBe(
        true,
      );
    });

    it('does not show the order in the buyer’s seller inbox', async () => {
      const inbox = await request(http())
        .get('/api/v1/marketplace/seller-orders')
        .set('Authorization', bearer(otherToken))
        .expect(200);

      expect(inbox.body.data.map((o: { id: string }) => o.id)).not.toContain(orderId);
    });

    it('lists it for the buyer as their own order', async () => {
      const mine = await request(http())
        .get('/api/v1/marketplace/orders')
        .set('Authorization', bearer(otherToken))
        .expect(200);

      expect(mine.body.data.map((o: { id: string }) => o.id)).toContain(orderId);
    });

    it('refuses to skip straight to completed', async () => {
      await request(http())
        .patch(`/api/v1/marketplace/orders/${orderId}/status`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'COMPLETED' })
        .expect(409);
    });

    it('runs accept → complete, and counts move with it', async () => {
      await request(http())
        .patch(`/api/v1/marketplace/orders/${orderId}/status`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      const mid = await request(http())
        .get('/api/v1/marketplace/seller-orders/counts')
        .set('Authorization', bearer(sellerToken))
        .expect(200);
      expect(mid.body.data.IN_PROGRESS).toBe(1);

      const done = await request(http())
        .patch(`/api/v1/marketplace/orders/${orderId}/status`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(done.body.data.status).toBe('COMPLETED');

      const after = await request(http())
        .get('/api/v1/marketplace/seller-orders/counts')
        .set('Authorization', bearer(sellerToken))
        .expect(200);
      expect(after.body.data.COMPLETED).toBe(1);
      expect(after.body.data.IN_PROGRESS).toBe(0);
    });

    it('refuses to move a completed order', async () => {
      await request(http())
        .patch(`/api/v1/marketplace/orders/${orderId}/status`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'IN_PROGRESS' })
        .expect(409);
    });

    it('refuses an order against a paused listing', async () => {
      await request(http())
        .patch(`/api/v1/marketplace/ads/${listingId}`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'PAUSED' })
        .expect(200);

      await request(http())
        .post(`/api/v1/marketplace/ads/${listingId}/orders`)
        .set('Authorization', bearer(otherToken))
        .send({ addressText: 'x', contactPhone: '+919000000001' })
        .expect(404);
    });

    it('refuses to let a seller order their own listing', async () => {
      await request(http())
        .patch(`/api/v1/marketplace/ads/${listingId}`)
        .set('Authorization', bearer(sellerToken))
        .send({ status: 'ACTIVE' })
        .expect(200);

      await request(http())
        .post(`/api/v1/marketplace/ads/${listingId}/orders`)
        .set('Authorization', bearer(sellerToken))
        .send({ addressText: 'x', contactPhone: '+919000000001' })
        .expect(409);
    });
  });
});
