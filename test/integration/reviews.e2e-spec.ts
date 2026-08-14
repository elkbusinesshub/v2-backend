import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Reviews against real MySQL/Redis: an order must be finished before it can be
 * rated, the rating-screen context, submitting a review (once), and the
 * aggregate landing on the listing itself.
 */
describe('Reviews (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;
  /** The seeded COMPLETED order — the one that can be rated. */
  let orderId: string;
  /** The seeded IN_PROGRESS order — the one that cannot be, yet. */
  let liveOrderId: string;
  let adId: string;

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

    const [user, admin, completed, live] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
      prisma.adOrder.findUnique({ where: { code: 'ELK-A-SEED2' } }),
      prisma.adOrder.findUnique({ where: { code: 'ELK-A-SEED1' } }),
    ]);
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
    orderId = completed!.id;
    liveOrderId = live!.id;
    adId = completed!.adId;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  it('refuses to rate an order that is not finished', async () => {
    await request(http())
      .get(`/api/v1/bookings/${liveOrderId}/review-target`)
      .set('Authorization', bearer(userToken))
      .expect(409);
  });

  it('404s an order the caller did not place', async () => {
    // Scoped to the buyer: the person who paid is the one who gets to rate it.
    await request(http())
      .get(`/api/v1/bookings/${orderId}/review-target`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
  });

  it('serves real rating-screen context for a completed order', async () => {
    const target = await request(http())
      .get(`/api/v1/bookings/${orderId}/review-target`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(target.body.data).toMatchObject({
      serviceName: 'Deep Home Cleaning',
      rewardPoints: 15,
    });
    expect(target.body.data.quickTags).toContain('Professional');
    expect(target.body.data.providerInitials).toHaveLength(2);
  });

  it('submits a review and rolls it into the listing’s rating', async () => {
    await request(http())
      .post(`/api/v1/bookings/${orderId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 5, tags: ['On Time', 'Professional'], comment: 'Excellent!' })
      .expect(201);

    const detail = await request(http())
      .get(`/api/v1/marketplace/ads/${adId}`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(detail.body.data.ratingAverage).toBe(5);
    expect(detail.body.data.ratingCount).toBe(1);
  });

  it('rejects a second review on the same order', async () => {
    await request(http())
      .post(`/api/v1/bookings/${orderId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 3, tags: [], comment: 'again' })
      .expect(409);
  });

  it('rejects an out-of-vocabulary tag', async () => {
    await request(http())
      .post(`/api/v1/bookings/${orderId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 4, tags: ['Not A Real Tag'], comment: '' })
      .expect(400);
  });

  it('requires auth on review routes', async () => {
    await request(http()).get(`/api/v1/bookings/${orderId}/review-target`).expect(401);
    await request(http()).post(`/api/v1/bookings/${orderId}/reviews`).expect(401);
  });
});
