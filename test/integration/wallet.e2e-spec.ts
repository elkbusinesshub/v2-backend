import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Wallet + Payments against real MySQL/Redis: the seeded balance/history,
 * payment methods (live wallet subLabel), a real wallet-method charge that
 * debits the balance, a mock non-wallet charge that only logs activity,
 * top-up/withdraw, and the insufficient-balance guard.
 */
describe('Wallet & Payments (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;

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

    const user = await prisma.user.findFirst({ where: { phone: '+971500000001' } });
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  it('serves the seeded wallet summary: balance, reward points, 5 transactions', async () => {
    const res = await request(http())
      .get('/api/v1/wallet')
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toMatchObject({ balance: 240.5, rewardPoints: 150 });
    expect(res.body.data.transactions).toHaveLength(5);
    expect(res.body.data.transactions[0]).toMatchObject({
      title: 'Deep Home Cleaning',
      date: '19 May 2026',
      amount: 119,
      isCredit: false,
    });
  });

  it('serves payment methods with the wallet subLabel computed from the live balance', async () => {
    const res = await request(http())
      .get('/api/v1/payments/methods')
      .set('Authorization', bearer(userToken))
      .expect(200);

    expect(res.body.data).toHaveLength(4);
    const wallet = res.body.data.find((m: { id: string }) => m.id === 'wallet');
    expect(wallet).toMatchObject({ label: 'ELK Wallet', subLabel: 'Balance: AED 241' });
    const card = res.body.data.find((m: { id: string }) => m.id === 'card');
    expect(card).toMatchObject({ subLabel: 'Visa, Mastercard, Amex' });
  });

  it('charges the wallet for real, debiting the balance and logging a transaction', async () => {
    const charge = await request(http())
      .post('/api/v1/payments/charge')
      .set('Authorization', bearer(userToken))
      .send({ methodId: 'wallet', amount: 40.5 })
      .expect(200);
    expect(charge.body.data.reference).toMatch(/^#ELK-\d{4}-\d{5}$/);

    const summary = await request(http())
      .get('/api/v1/wallet')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(summary.body.data.balance).toBe(200);
    expect(summary.body.data.transactions).toHaveLength(6);
    expect(summary.body.data.transactions[0]).toMatchObject({ title: 'Payment', amount: 40.5 });
  });

  it('mock-charges a non-wallet method: logs activity but leaves the balance untouched', async () => {
    await request(http())
      .post('/api/v1/payments/charge')
      .set('Authorization', bearer(userToken))
      .send({ methodId: 'card', amount: 89 })
      .expect(200);

    const summary = await request(http())
      .get('/api/v1/wallet')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(summary.body.data.balance).toBe(200); // unchanged — not paid from wallet
    expect(summary.body.data.transactions).toHaveLength(7);
  });

  it('rejects a wallet charge beyond the current balance', async () => {
    await request(http())
      .post('/api/v1/payments/charge')
      .set('Authorization', bearer(userToken))
      .send({ methodId: 'wallet', amount: 10_000 })
      .expect(402);
  });

  it('tops up, then withdraws, updating the balance each time', async () => {
    const topUp = await request(http())
      .post('/api/v1/wallet/top-up')
      .set('Authorization', bearer(userToken))
      .send({ amount: 100 })
      .expect(200);
    expect(topUp.body.data.balance).toBe(300);

    const withdraw = await request(http())
      .post('/api/v1/wallet/withdraw')
      .set('Authorization', bearer(userToken))
      .send({ amount: 50 })
      .expect(200);
    expect(withdraw.body.data.balance).toBe(250);
  });

  it('rejects a withdrawal beyond the current balance', async () => {
    await request(http())
      .post('/api/v1/wallet/withdraw')
      .set('Authorization', bearer(userToken))
      .send({ amount: 10_000 })
      .expect(402);
  });

  it('rejects a non-positive amount', async () => {
    await request(http())
      .post('/api/v1/wallet/top-up')
      .set('Authorization', bearer(userToken))
      .send({ amount: -5 })
      .expect(400);
  });

  it('requires auth on every route', async () => {
    await request(http()).get('/api/v1/wallet').expect(401);
    await request(http()).get('/api/v1/payments/methods').expect(401);
    await request(http()).post('/api/v1/payments/charge').expect(401);
  });
});
