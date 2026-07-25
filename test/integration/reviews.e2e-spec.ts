import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Reviews against real MySQL/Redis: the admin-only booking completion
 * step, the rating-screen context, submitting a review (once), and the
 * real rating/reviewCount aggregate replacing the seeded Service values.
 */
describe('Reviews (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;
  let bookingId: string;
  let serviceId: string;

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

    const [user, admin] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
    ]);
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  it('creates a home-services booking to review', async () => {
    const services = await request(http())
      .get('/api/v1/services')
      .set('Authorization', bearer(userToken))
      .expect(200);
    const flatServices = services.body.data.flatMap(
      (group: { items: { id: string }[] }) => group.items,
    );
    serviceId = flatServices[0].id;

    const options = await request(http())
      .get(`/api/v1/services/${serviceId}/booking-options`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    const day = options.body.data.dates[0].day;
    const time = options.body.data.timeSlots[0].time;

    const create = await request(http())
      .post('/api/v1/bookings')
      .set('Authorization', bearer(userToken))
      .send({ serviceId, day, time, address: 'Tower 3, Apt 1204, Al Reem Island' })
      .expect(201);

    const reference = create.body.data.bookingReference;
    const list = await request(http())
      .get('/api/v1/bookings')
      .set('Authorization', bearer(userToken))
      .expect(200);
    bookingId = list.body.data.find((b: { reference: string }) => b.reference === reference).id;
  });

  it('blocks review-target and completion before the booking is COMPLETED', async () => {
    await request(http())
      .get(`/api/v1/bookings/${bookingId}/review-target`)
      .set('Authorization', bearer(userToken))
      .expect(409);

    // regular users cannot mark a booking complete
    await request(http())
      .post(`/api/v1/bookings/${bookingId}/complete`)
      .set('Authorization', bearer(userToken))
      .expect(403);
  });

  it('admin completes the booking, then the rating screen serves real context', async () => {
    await request(http())
      .post(`/api/v1/bookings/${bookingId}/complete`)
      .set('Authorization', bearer(adminToken))
      .expect(200);

    const target = await request(http())
      .get(`/api/v1/bookings/${bookingId}/review-target`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(target.body.data).toMatchObject({ rewardPoints: 15 });
    expect(target.body.data.quickTags).toContain('Professional');
    expect(target.body.data.providerInitials).toHaveLength(2);
  });

  it('submits a review and recomputes the service rating aggregate', async () => {
    await request(http())
      .post(`/api/v1/bookings/${bookingId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 5, tags: ['On Time', 'Professional'], comment: 'Excellent!' })
      .expect(201);

    const detail = await request(http())
      .get(`/api/v1/services/${serviceId}`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(detail.body.data.rating).toBe(5);
    expect(detail.body.data.reviewCount).toBe(1);
  });

  it('rejects a second review on the same booking', async () => {
    await request(http())
      .post(`/api/v1/bookings/${bookingId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 3, tags: [], comment: 'again' })
      .expect(409);
  });

  it('rejects an out-of-vocabulary tag', async () => {
    await request(http())
      .post(`/api/v1/bookings/${bookingId}/reviews`)
      .set('Authorization', bearer(userToken))
      .send({ rating: 4, tags: ['Not A Real Tag'], comment: '' })
      .expect(400);
  });

  it('requires auth on review routes', async () => {
    await request(http()).get(`/api/v1/bookings/${bookingId}/review-target`).expect(401);
    await request(http()).post(`/api/v1/bookings/${bookingId}/reviews`).expect(401);
  });
});
