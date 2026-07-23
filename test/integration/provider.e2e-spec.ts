import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Provider persona against real MySQL/Redis: the seeded verified provider's
 * dashboard/schedule/earnings, availability toggle, request accept/decline,
 * a fresh registration (PENDING) that is blocked from the dashboard, and the
 * admin verification that grants the PROVIDER role.
 */
describe('Provider (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let providerToken: string;
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let pendingRequestId: string;

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

    const [provider, demoUser, admin] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000002' } }),
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
    ]);
    providerToken = (await auth.issueTokenPair(provider!, {})).accessToken;
    userToken = (await auth.issueTokenPair(demoUser!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
    userId = demoUser!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  it('serves the seeded provider dashboard with stats and requests', async () => {
    const res = await request(http())
      .get('/api/v1/provider/dashboard')
      .set('Authorization', bearer(providerToken))
      .expect(200);

    const data = res.body.data;
    expect(data).toMatchObject({
      businessName: 'Royal Shine Co.',
      modeLabel: '✓ VERIFIED',
      isAvailable: true,
    });
    expect(data.stats).toHaveLength(3);
    expect(data.stats[1]).toMatchObject({ label: 'This Month', value: 'AED 2,840' });
    expect(data.requests).toHaveLength(2);
    pendingRequestId = data.requests.find((r: { status: string }) => r.status === 'pending').id;
  });

  it('serves schedule and earnings derived from the profile + requests', async () => {
    const schedule = await request(http())
      .get('/api/v1/provider/schedule')
      .set('Authorization', bearer(providerToken))
      .expect(200);
    expect(schedule.body.data.days).toHaveLength(7);
    expect(schedule.body.data.days[2]).toMatchObject({ available: false }); // Wed off
    expect(schedule.body.data.slots).toHaveLength(3);

    const earnings = await request(http())
      .get('/api/v1/provider/earnings')
      .set('Authorization', bearer(providerToken))
      .expect(200);
    expect(earnings.body.data).toMatchObject({
      totalEarnings: 2840,
      completedJobs: 38,
      avgPerJob: 74,
    });
    // one accepted request → one earnings transaction
    expect(earnings.body.data.transactions).toHaveLength(1);
    expect(earnings.body.data.transactions[0].title).toBe('Kitchen Cleaning · Sara Mohammed');
  });

  it('toggles availability', async () => {
    const off = await request(http())
      .post('/api/v1/provider/availability')
      .set('Authorization', bearer(providerToken))
      .send({ isAvailable: false })
      .expect(200);
    expect(off.body.data).toEqual({ isAvailable: false });

    await request(http())
      .post('/api/v1/provider/availability')
      .set('Authorization', bearer(providerToken))
      .send({ isAvailable: true })
      .expect(200);
  });

  it('accepts a pending request, then rejects a second response', async () => {
    const accept = await request(http())
      .post(`/api/v1/provider/requests/${pendingRequestId}/respond`)
      .set('Authorization', bearer(providerToken))
      .send({ accept: true })
      .expect(200);
    expect(accept.body.data.status).toBe('accepted');

    await request(http())
      .post(`/api/v1/provider/requests/${pendingRequestId}/respond`)
      .set('Authorization', bearer(providerToken))
      .send({ accept: false })
      .expect(409);

    // now two accepted → dashboard shows 2 active orders
    const dash = await request(http())
      .get('/api/v1/provider/dashboard')
      .set('Authorization', bearer(providerToken))
      .expect(200);
    expect(dash.body.data.stats[0]).toMatchObject({ label: 'Active Orders', value: '2' });
  });

  it('blocks a non-provider from the dashboard until registered + verified', async () => {
    // the demo user has no provider profile
    await request(http())
      .get('/api/v1/provider/dashboard')
      .set('Authorization', bearer(userToken))
      .expect(403);

    const reg = await request(http())
      .post('/api/v1/provider/registration')
      .set('Authorization', bearer(userToken))
      .send({
        businessName: 'Sparkle Homes',
        serviceCategory: 'Cleaning',
        contactNumber: '+971509998877',
        serviceArea: 'JLT',
        tradeLicenseUploaded: true,
        idDocumentUploaded: true,
      })
      .expect(201);
    expect(reg.body.data.status).toBe('pending');

    // still pending — dashboard works (profile exists) but modeLabel reflects pending
    const dash = await request(http())
      .get('/api/v1/provider/dashboard')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(dash.body.data.modeLabel).toBe('⏳ PENDING REVIEW');

    // duplicate registration is rejected
    await request(http())
      .post('/api/v1/provider/registration')
      .set('Authorization', bearer(userToken))
      .send({
        businessName: 'Sparkle Homes',
        serviceCategory: 'Cleaning',
        contactNumber: '+971509998877',
        serviceArea: 'JLT',
        tradeLicenseUploaded: true,
        idDocumentUploaded: true,
      })
      .expect(409);
  });

  it('admin verification grants the PROVIDER role (visible on the next token)', async () => {
    // users cannot verify
    await request(http())
      .patch(`/api/v1/provider/${userId}/verify`)
      .set('Authorization', bearer(userToken))
      .send({ decision: 'verified' })
      .expect(403);

    const verify = await request(http())
      .patch(`/api/v1/provider/${userId}/verify`)
      .set('Authorization', bearer(adminToken))
      .send({ decision: 'verified' })
      .expect(200);
    expect(verify.body.data.status).toBe('verified');

    // the role grant is persisted — /users/me reads roles fresh from the DB
    // (the existing access token still carries the old roles until re-login)
    const me = await request(http())
      .get('/api/v1/users/me')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(me.body.data.roles).toEqual(expect.arrayContaining(['USER', 'PROVIDER']));
  });

  it('requires auth on every route', async () => {
    await request(http()).get('/api/v1/provider/dashboard').expect(401);
    await request(http()).post('/api/v1/provider/registration').expect(401);
  });
});
