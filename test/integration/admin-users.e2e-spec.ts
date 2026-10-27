import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * The super admin's account management against real MySQL/Redis: creating
 * admins and super admins, editing their details, roles that never change,
 * customers that can't be edited, and staff accounts that can't buy or sell.
 */
describe('Admin users — staff accounts (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let superAdminToken: string;
  let adminToken: string;
  let customerId: string;

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

    const superAdmin = await prisma.user.create({
      data: { phone: '+919000000001', name: 'Test Super Admin', userType: 'SUPER_ADMIN' },
    });
    const [admin, customer] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
    ]);
    superAdminToken = (await auth.issueTokenPair(superAdmin, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;
    customerId = customer!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  let createdId: string;

  it('creates an admin with the modules they run', async () => {
    const res = await request(http())
      .post('/api/v1/admin/users')
      .set('Authorization', bearer(superAdminToken))
      .send({ role: 'ADMIN', name: 'Sparkle Cleaners', phone: '9846000003', modules: ['CLEAN'] })
      .expect(201);

    expect(res.body.data).toMatchObject({
      name: 'Sparkle Cleaners',
      phone: '+919846000003',
      email: null,
      role: 'ADMIN',
      modules: ['CLEAN'],
    });
    createdId = res.body.data.id;
  });

  it('creates a super admin, who holds no modules', async () => {
    const res = await request(http())
      .post('/api/v1/admin/users')
      .set('Authorization', bearer(superAdminToken))
      .send({ role: 'SUPER_ADMIN', name: 'Second Owner', phone: '+91 98460 00004' })
      .expect(201);

    expect(res.body.data).toMatchObject({ role: 'SUPER_ADMIN', modules: [] });
  });

  it('refuses an admin with no modules, a customer role and a number in use', async () => {
    const post = (body: object) =>
      request(http())
        .post('/api/v1/admin/users')
        .set('Authorization', bearer(superAdminToken))
        .send(body);

    await post({ role: 'ADMIN', name: 'No Modules', phone: '9846000005' }).expect(400);
    await post({ role: 'USER', name: 'Customer', phone: '9846000006' }).expect(400);
    const taken = await post({
      role: 'ADMIN',
      name: 'Dup',
      phone: '9846000003',
      modules: ['CLEAN'],
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe('PHONE_IN_USE');
  });

  it('edits an admin’s details and modules', async () => {
    const res = await request(http())
      .patch(`/api/v1/admin/users/${createdId}`)
      .set('Authorization', bearer(superAdminToken))
      .send({ name: 'Sparkle Homes', email: 'hello@sparkle.example', modules: ['CLEAN', 'REPAIR'] })
      .expect(200);

    expect(res.body.data).toMatchObject({
      name: 'Sparkle Homes',
      email: 'hello@sparkle.example',
      role: 'ADMIN',
      modules: ['CLEAN', 'REPAIR'],
    });
  });

  it('never changes a role', async () => {
    await request(http())
      .patch(`/api/v1/admin/users/${createdId}`)
      .set('Authorization', bearer(superAdminToken))
      .send({ role: 'USER' })
      .expect(400);
  });

  it('refuses to edit a customer', async () => {
    const res = await request(http())
      .patch(`/api/v1/admin/users/${customerId}`)
      .set('Authorization', bearer(superAdminToken))
      .send({ name: 'Renamed' })
      .expect(409);
    expect(res.body.error).toBe('CUSTOMER_ACCOUNT');
  });

  it('is for super admins only', async () => {
    await request(http())
      .post('/api/v1/admin/users')
      .set('Authorization', bearer(adminToken))
      .send({ role: 'ADMIN', name: 'Sneaky', phone: '9846000007', modules: ['CLEAN'] })
      .expect(403);
  });

  it('keeps staff accounts out of buying and selling', async () => {
    await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(adminToken))
      .send({ title: 'Staff listing', categorySlug: 'cleaning', price: 500 })
      .expect(403);
  });
});
