import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * The listing flow against real MySQL/Redis: a seller publishes into one of
 * the four listing categories, a buyer browses and filters by category, price,
 * area and text, and opens one listing to get the seller's contact details.
 * Ads from the booking verticals must never show up here.
 */
describe('Listings — publish, browse, filter (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let sellerToken: string;
  let buyerToken: string;

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

    const [seller, buyer] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000002' } }),
    ]);
    sellerToken = (await auth.issueTokenPair(seller!, {})).accessToken;
    buyerToken = (await auth.issueTokenPair(buyer!, {})).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;

  const browse = async (query: Record<string, string | number>): Promise<string[]> => {
    const res = await request(http())
      .get('/api/v1/listings')
      .query(query)
      .set('Authorization', bearer(buyerToken))
      .expect(200);
    return (res.body.data as { title: string }[]).map((a) => a.title);
  };

  let drillId: string;

  it('publishes listings in each category', async () => {
    const drill = await request(http())
      .post('/api/v1/listings')
      .set('Authorization', bearer(sellerToken))
      .send({
        title: 'Bosch Drill Machine',
        description: 'Cordless, two batteries',
        categorySlug: 'listing_tool_rental',
        price: 300,
        locality: 'Indiranagar',
        city: 'Bengaluru',
      })
      .expect(201);

    expect(drill.body.data).toMatchObject({
      title: 'Bosch Drill Machine',
      categorySlug: 'listing_tool_rental',
      price: 300,
      location: 'Indiranagar, Bengaluru',
      status: 'ACTIVE',
    });
    drillId = drill.body.data.id;

    for (const body of [
      { title: 'Kitchen Deep Clean', categorySlug: 'listing_cleaning', price: 1500, city: 'Kochi' },
      { title: 'Lakeside Homestay', categorySlug: 'listing_stay', price: 2500, city: 'Munnar' },
      { title: 'Tap Leak Fix', categorySlug: 'listing_repair', price: 400, city: 'Bengaluru' },
    ]) {
      await request(http())
        .post('/api/v1/listings')
        .set('Authorization', bearer(sellerToken))
        .send(body)
        .expect(201);
    }
  });

  it('never lists an ad from a booking vertical', async () => {
    await request(http())
      .post('/api/v1/marketplace/ads')
      .set('Authorization', bearer(sellerToken))
      .send({ title: 'Vertical Sofa Clean', categorySlug: 'cleaning', price: 900 })
      .expect(201);

    const titles = await browse({});
    expect(titles).toEqual(
      expect.arrayContaining([
        'Bosch Drill Machine',
        'Kitchen Deep Clean',
        'Lakeside Homestay',
        'Tap Leak Fix',
      ]),
    );
    expect(titles).not.toContain('Vertical Sofa Clean');
  });

  it('filters by category, price, area and text', async () => {
    expect(await browse({ category: 'listing_stay' })).toEqual(['Lakeside Homestay']);
    expect((await browse({ minPrice: 1000, maxPrice: 2000 })).sort()).toEqual([
      'Kitchen Deep Clean',
    ]);
    expect((await browse({ area: 'bengaluru' })).sort()).toEqual([
      'Bosch Drill Machine',
      'Tap Leak Fix',
    ]);
    expect(await browse({ area: 'Indira' })).toEqual(['Bosch Drill Machine']);
    expect(await browse({ q: 'drill', category: 'listing_tool_rental' })).toEqual([
      'Bosch Drill Machine',
    ]);
    expect(await browse({ category: 'listing_repair', minPrice: 1000 })).toEqual([]);
  });

  it('pages newest first without repeats', async () => {
    const first = await browse({ limit: 2, offset: 0 });
    const second = await browse({ limit: 2, offset: 2 });
    expect(first).toEqual(['Tap Leak Fix', 'Lakeside Homestay']);
    expect(second).toEqual(['Kitchen Deep Clean', 'Bosch Drill Machine']);
  });

  it('gives the buyer contact details on the single listing only', async () => {
    const res = await request(http())
      .get(`/api/v1/marketplace/ads/${drillId}`)
      .set('Authorization', bearer(buyerToken))
      .expect(200);
    expect(res.body.data.sellerId).toBeDefined();
    expect(res.body.data.sellerPhone).not.toBeNull();

    const list = await request(http())
      .get('/api/v1/listings')
      .set('Authorization', bearer(buyerToken))
      .expect(200);
    for (const card of list.body.data) {
      expect(card.sellerPhone).toBeNull();
    }
  });

  it('rejects a category outside the listing flow, and bad filters', async () => {
    await request(http())
      .post('/api/v1/listings')
      .set('Authorization', bearer(sellerToken))
      .send({ title: 'Wrong', categorySlug: 'cleaning', price: 10 })
      .expect(400);

    await request(http())
      .post('/api/v1/listings')
      .set('Authorization', bearer(sellerToken))
      .send({ title: '', categorySlug: 'listing_repair', price: 10 })
      .expect(400);

    await request(http())
      .post('/api/v1/listings')
      .set('Authorization', bearer(sellerToken))
      .send({ title: 'Attrs', categorySlug: 'listing_repair', price: 10, attributes: {} })
      .expect(400);

    await request(http())
      .get('/api/v1/listings')
      .query({ minPrice: 500, maxPrice: 100 })
      .set('Authorization', bearer(buyerToken))
      .expect(400);

    await request(http())
      .get('/api/v1/listings')
      .query({ category: 'car_rental' })
      .set('Authorization', bearer(buyerToken))
      .expect(400);
  });

  it('requires a signed-in user', async () => {
    await request(http()).get('/api/v1/listings').expect(401);
    await request(http())
      .post('/api/v1/listings')
      .send({ title: 'Anon', categorySlug: 'listing_repair', price: 10 })
      .expect(401);
  });
});
