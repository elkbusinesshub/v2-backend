import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Offers + language config against real MySQL/Redis: the seeded reward
 * points summary, active offer banners, admin-only banner creation, and
 * the language endpoints (/config/languages, /users/me/language).
 */
describe('Offers & Config (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
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

  it('serves the seeded reward points summary + 2 offer banners', async () => {
    const res = await request(http())
      .get('/api/v1/offers')
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toMatchObject({
      rewardPoints: 150,
      rewardDiscountLabel: '≈ AED 15 discount available',
    });
    expect(res.body.data.offers).toHaveLength(2);
    expect(res.body.data.offers[0]).toMatchObject({ code: 'ELK20', discountLabel: '20%' });
  });

  it('enforces admin RBAC on creating an offer banner', async () => {
    await request(http())
      .post('/api/v1/offers')
      .set('Authorization', bearer(userToken))
      .send({
        tagLabel: 'FLASH',
        title: 'Flash Sale',
        description: 'Limited time',
        code: 'FLASH10',
        expiryLabel: 'Today only',
        discountLabel: '10%',
        discountSubLabel: 'OFF',
        gradientStartHex: 0xff000000,
        gradientEndHex: 0xffffffff,
      })
      .expect(403);

    await request(http())
      .post('/api/v1/offers')
      .set('Authorization', bearer(adminToken))
      .send({
        tagLabel: 'FLASH',
        title: 'Flash Sale',
        description: 'Limited time',
        code: 'FLASH10',
        expiryLabel: 'Today only',
        discountLabel: '10%',
        discountSubLabel: 'OFF',
        gradientStartHex: 0xff000000,
        gradientEndHex: 0xffffffff,
      })
      .expect(201);

    const list = await request(http())
      .get('/api/v1/offers')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(list.body.data.offers).toHaveLength(3);
  });

  it('serves the static supported-languages list', async () => {
    const res = await request(http())
      .get('/api/v1/config/languages')
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toHaveLength(4);
    expect(res.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'en', name: 'English' })]),
    );
  });

  it('updates the preferred language via /users/me/language', async () => {
    const res = await request(http())
      .patch('/api/v1/users/me/language')
      .set('Authorization', bearer(userToken))
      .send({ language: 'ml' })
      .expect(200);
    expect(res.body.data.language).toBe('ml');

    const me = await request(http())
      .get('/api/v1/users/me')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(me.body.data.language).toBe('ml');

    // restore the default in case a later test in this file assumes it
    await request(http())
      .patch('/api/v1/users/me/language')
      .set('Authorization', bearer(userToken))
      .send({ language: 'en' })
      .expect(200);
  });

  it('rejects a malformed language code', async () => {
    await request(http())
      .patch('/api/v1/users/me/language')
      .set('Authorization', bearer(userToken))
      .send({ language: 'english' })
      .expect(400);
  });

  it('requires auth on every route', async () => {
    await request(http()).get('/api/v1/offers').expect(401);
    await request(http()).get('/api/v1/config/languages').expect(401);
  });
});
