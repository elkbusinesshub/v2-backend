import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Notifications against real MySQL/Redis: the seeded list with computed
 * relative time, mark-all-read, admin-only creation, and per-user isolation.
 */
describe('Notifications (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;
  let adminId: string;

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
    adminId = admin!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  it('lists the seeded notifications with computed relative time', async () => {
    const res = await request(http())
      .get('/api/v1/notifications')
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toHaveLength(5);
    const latest = res.body.data[0];
    expect(latest).toMatchObject({
      icon: '🧹',
      title: 'Provider On The Way',
      time: '2 min ago',
      isUnread: true,
    });
    expect(res.body.data.filter((n: { isUnread: boolean }) => n.isUnread)).toHaveLength(2);
  });

  it('regular users cannot create notifications for others', async () => {
    await request(http())
      .post('/api/v1/notifications')
      .set('Authorization', bearer(userToken))
      .send({ userId: adminId, icon: '🎉', colorHex: 0xfffef3c7, title: 'Hi', message: 'Test' })
      .expect(403);
  });

  it('admin creates a notification for a target user, isolated per user', async () => {
    await request(http())
      .post('/api/v1/notifications')
      .set('Authorization', bearer(adminToken))
      .send({
        userId: adminId,
        icon: '🎉',
        colorHex: 0xfffef3c7,
        title: 'Admin ping',
        message: 'For admin only',
      })
      .expect(201);

    // the demo user's list is unaffected — the new row belongs to the admin
    const userList = await request(http())
      .get('/api/v1/notifications')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(userList.body.data).toHaveLength(5);

    const adminList = await request(http())
      .get('/api/v1/notifications')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(adminList.body.data[0]).toMatchObject({ title: 'Admin ping' });
  });

  it('marks every unread notification read', async () => {
    await request(http())
      .post('/api/v1/notifications/mark-all-read')
      .set('Authorization', bearer(userToken))
      .expect(200);

    const list = await request(http())
      .get('/api/v1/notifications')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(list.body.data.every((n: { isUnread: boolean }) => !n.isUnread)).toBe(true);
  });

  it('requires auth on every route', async () => {
    await request(http()).get('/api/v1/notifications').expect(401);
    await request(http()).post('/api/v1/notifications/mark-all-read').expect(401);
  });
});
