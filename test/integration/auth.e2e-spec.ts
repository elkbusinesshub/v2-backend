import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Role, type User } from '@prisma/client';
import type Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Full-stack integration: real Nest app (production pipeline via
 * configureApp) + real MySQL + real Redis from Testcontainers.
 * Covers: envelope shape, guard behaviour, refresh rotation, reuse
 * detection (family revocation), logout denylist.
 */
describe('Auth (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;
  let user: User;
  let redisClient: Redis;
  // resolved lazily so env vars are set before src/config is imported
  let authService: import('@/modules/auth/auth.service').AuthService;

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

    execSync('npx prisma migrate deploy', {
      env: process.env,
      stdio: 'inherit',
    });

    const { AppModule } = await import('@/app.module');
    const { configureApp } = await import('@/app.setup');
    const { AuthService } = await import('@/modules/auth/auth.service');
    const { PRISMA } = await import('@/database/prisma.constants');
    const { REDIS_CLIENT } = await import('@/cache/redis.constants');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    authService = app.get(AuthService);
    redisClient = app.get<Redis>(REDIS_CLIENT);
    const prisma = app.get<import('@/database/prisma.extension').ExtendedPrismaClient>(PRISMA);
    user = await prisma.user.create({
      data: { phone: '+971509999999', name: 'Integration User', roles: [Role.USER] },
    });
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();

  it('GET /health/ready reports dependencies up', async () => {
    const res = await request(http()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('requests and verifies an OTP, creating the user on first login', async () => {
    const phone = '+971501112222';

    const requestRes = await request(http())
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .expect(200);
    expect(requestRes.body.data.resendInSeconds).toBeGreaterThan(0);

    const code = await redisClient.get(`auth:otp:${phone}`);
    expect(code).toMatch(/^\d{4}$/);

    const verifyRes = await request(http())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, otp: code })
      .expect(200);
    expect(verifyRes.body).toMatchObject({ success: true, data: { tokenType: 'Bearer' } });

    // the code is single-use
    await request(http()).post('/api/v1/auth/otp/verify').send({ phone, otp: code }).expect(401);
  });

  it('rejects an incorrect OTP with the error envelope', async () => {
    const phone = '+971503334444';
    await request(http()).post('/api/v1/auth/otp/request').send({ phone }).expect(200);

    const res = await request(http())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, otp: '0000' })
      .expect(401);
    expect(res.body).toMatchObject({ success: false, error: 'UNAUTHENTICATED' });
  });

  it('rejects an unauthenticated request with the error envelope', async () => {
    const res = await request(http()).get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ success: false, error: 'UNAUTHENTICATED' });
  });

  it('authenticates with an issued access token and wraps data in the envelope', async () => {
    const pair = await authService.issueTokenPair(user, {});
    const res = await request(http())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .expect(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'OK',
      data: { id: user.id, roles: [Role.USER] },
    });
  });

  it('validates request bodies through the global pipe', async () => {
    const res = await request(http()).post('/api/v1/auth/refresh').send({}).expect(400);
    expect(res.body).toMatchObject({ success: false, error: 'VALIDATION_ERROR' });
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'refreshToken' })]),
    );
  });

  it('rotates refresh tokens and kills the family on reuse', async () => {
    const pair1 = await authService.issueTokenPair(user, {});

    // legitimate rotation
    const res1 = await request(http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: pair1.refreshToken })
      .expect(200);
    const pair2 = res1.body.data as { refreshToken: string };
    expect(pair2.refreshToken).not.toBe(pair1.refreshToken);

    // replaying the OLD token = reuse → 401 and the whole family dies
    await request(http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: pair1.refreshToken })
      .expect(401);

    // even the newest token in the chain is now revoked
    await request(http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: pair2.refreshToken })
      .expect(401);
  });

  it('logout revokes the session and denylists the live access token', async () => {
    const pair = await authService.issueTokenPair(user, {});

    await request(http())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .send({ refreshToken: pair.refreshToken })
      .expect(200);

    // access token is dead immediately, despite its 15-minute expiry
    await request(http())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .expect(401);

    // and the refresh token is unusable
    await request(http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
  });
});
