import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * ELK Stay module against real MySQL/Redis: browse + filters, detail,
 * favorites, booking with server-side pricing, visits, cancellation rules,
 * and provider/admin RBAC on management endpoints.
 */
describe('ElkStay (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let providerToken: string;
  let adminToken: string;
  let stayId: string;
  let roomOptionId: string;

  const futureDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

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

    const [user, provider, admin] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000002' } }),
      prisma.user.findFirst({ where: { phone: '+971500000000' } }),
    ]);
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
    providerToken = (await auth.issueTokenPair(provider!, {})).accessToken;
    adminToken = (await auth.issueTokenPair(admin!, {})).accessToken;

    const maple = await prisma.stay.findUnique({
      where: { slug: 'maple-nest' },
      include: { roomOptions: { orderBy: { sortOrder: 'asc' } } },
    });
    stayId = maple!.id;
    roomOptionId = maple!.roomOptions[1]!.id; // Double Sharing, 11000
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const asUser = (t: string) => `Bearer ${t}`;

  it('serves the home feed with live category counts and top rated stays', async () => {
    const res = await request(http())
      .get('/api/v1/elkstay/home')
      .set('Authorization', asUser(userToken))
      .expect(200);

    const feed = res.body.data;
    expect(feed.userName).toBe('Demo');
    expect(feed.categories).toHaveLength(4);
    const pg = feed.categories.find((c: { type: string }) => c.type === 'pg_stay');
    expect(pg).toMatchObject({ name: 'PG Stays', emoji: '🏠', count: 1 });
    expect(feed.topRated).toHaveLength(4);
    // top rated is sorted by rating desc — Birch Homestay (4.9) first
    expect(feed.topRated[0].name).toBe('Birch Homestay');
    expect(typeof feed.topRated[0].gradientStart).toBe('number');
  });

  it('filters listings by category, price and meals', async () => {
    const mens = await request(http())
      .get('/api/v1/elkstay/stays?category=mens_hostel')
      .set('Authorization', asUser(userToken))
      .expect(200);
    expect(mens.body.data).toHaveLength(2);
    expect(mens.body.meta).toMatchObject({ total: 2, page: 1 });

    const cheap = await request(http())
      .get('/api/v1/elkstay/stays?maxPrice=9000&meals=true')
      .set('Authorization', asUser(userToken))
      .expect(200);
    // under 9000 with a meals amenity → Cedar House (8900) only
    expect(cheap.body.data.map((s: { name: string }) => s.name)).toEqual(['Cedar House']);

    const searched = await request(http())
      .get('/api/v1/elkstay/stays?search=indiranagar')
      .set('Authorization', asUser(userToken))
      .expect(200);
    expect(searched.body.data.length).toBe(2); // Pine Loft + Birch Homestay
  });

  it('serves stay detail with room options and persists favorites', async () => {
    const before = await request(http())
      .get(`/api/v1/elkstay/stay/${stayId}`)
      .set('Authorization', asUser(userToken))
      .expect(200);
    expect(before.body.data).toMatchObject({ name: 'Maple Nest Residency', isSaved: false });
    expect(before.body.data.roomOptions).toHaveLength(3);
    expect(before.body.data.amenities[0]).toEqual({ iconKey: 'wifi', label: '100 Mbps Wi-Fi' });

    await request(http())
      .post(`/api/v1/elkstay/stay/${stayId}/favorite`)
      .set('Authorization', asUser(userToken))
      .expect(200);

    const after = await request(http())
      .get(`/api/v1/elkstay/stay/${stayId}`)
      .set('Authorization', asUser(userToken))
      .expect(200);
    expect(after.body.data.isSaved).toBe(true);

    const favorites = await request(http())
      .get('/api/v1/elkstay/favorites')
      .set('Authorization', asUser(userToken))
      .expect(200);
    expect(favorites.body.data).toHaveLength(1);
  });

  it('creates a booking with server-computed pricing and lists it', async () => {
    const res = await request(http())
      .post('/api/v1/elkstay/bookings')
      .set('Authorization', asUser(userToken))
      .send({
        stayId,
        roomOptionId,
        moveInDate: futureDate,
        durationMonths: 6,
        couponCode: 'ELKNEW',
        paymentMethod: 'upi',
      })
      .expect(201);

    const booking = res.body.data;
    expect(booking.code).toMatch(/^ELK-[A-Z0-9]{5}$/);
    expect(booking.status).toBe('confirmed');
    expect(booking.primaryDateLabel).toBe('Move-in');
    expect(booking.breakdown).toEqual({
      firstMonthRent: 11000,
      securityDeposit: 11000,
      serviceFee: 499,
      discount: 500,
      total: 21999,
    });

    const list = await request(http())
      .get('/api/v1/elkstay/bookings')
      .set('Authorization', asUser(userToken))
      .expect(200);
    const codes = list.body.data.map((b: { code: string }) => b.code);
    expect(codes).toContain(booking.code);
    // seed bookings are present too, with computed labels
    const seeded = list.body.data.find((b: { code: string }) => b.code === 'ELK-SEED1');
    expect(seeded).toMatchObject({
      status: 'confirmed',
      primaryDate: '12 Jun 2026',
      secondaryLabel: 'Next due',
      secondaryValue: '01 Jul',
    });
  });

  it('rejects a room option from a different stay', async () => {
    const res = await request(http())
      .post('/api/v1/elkstay/bookings')
      .set('Authorization', asUser(userToken))
      .send({
        stayId,
        roomOptionId: '00000000-0000-7000-8000-000000000000',
        moveInDate: futureDate,
        durationMonths: 6,
        paymentMethod: 'card',
      })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('schedules a visit, blocks duplicates, and cancels it', async () => {
    const visitAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

    const res = await request(http())
      .post('/api/v1/elkstay/visits')
      .set('Authorization', asUser(userToken))
      .send({ stayId, visitAt })
      .expect(201);
    expect(res.body.data.status).toBe('visit_booked');
    expect(res.body.data.primaryDateLabel).toBe('Visit');

    await request(http())
      .post('/api/v1/elkstay/visits')
      .set('Authorization', asUser(userToken))
      .send({ stayId, visitAt })
      .expect(409);

    await request(http())
      .post(`/api/v1/elkstay/bookings/${res.body.data.id}/cancel`)
      .set('Authorization', asUser(userToken))
      .expect(200);

    // a confirmed stay booking cannot be cancelled
    const list = await request(http())
      .get('/api/v1/elkstay/bookings')
      .set('Authorization', asUser(userToken))
      .expect(200);
    const confirmed = list.body.data.find((b: { status: string }) => b.status === 'confirmed');
    await request(http())
      .post(`/api/v1/elkstay/bookings/${confirmed.id}/cancel`)
      .set('Authorization', asUser(userToken))
      .expect(409);
  });

  it('enforces RBAC on management endpoints', async () => {
    const newStay = {
      name: 'Test Lodge',
      categoryType: 'homestay',
      badge: 'Homestay',
      roomType: 'Private room',
      location: 'Test Area',
      fullAddress: 'Test Street · 1.0 km away',
      distanceKm: 1.0,
      description: 'A test listing with enough description text.',
      gradientStart: 4281686860,
      gradientEnd: 4283659873,
      amenities: [{ iconKey: 'wifi', label: 'Wi-Fi' }],
      roomOptions: [
        { kind: 'Single Sharing', subtitle: 'Private', pricePerMonth: 12000 },
        { kind: 'Double Sharing', subtitle: 'Shared', pricePerMonth: 9000 },
      ],
    };

    // plain user: forbidden
    await request(http())
      .post('/api/v1/elkstay/stays')
      .set('Authorization', asUser(userToken))
      .send(newStay)
      .expect(403);

    // provider: allowed; starting price = cheapest room option
    const created = await request(http())
      .post('/api/v1/elkstay/stays')
      .set('Authorization', asUser(providerToken))
      .send(newStay)
      .expect(201);
    expect(created.body.data.pricePerMonth).toBe(9000);
    expect(created.body.data.isVerified).toBe(false);

    const createdId = created.body.data.id;

    // provider cannot verify — admin approval only
    await request(http())
      .patch(`/api/v1/elkstay/stays/${createdId}/verify`)
      .set('Authorization', asUser(providerToken))
      .send({ isVerified: true })
      .expect(403);

    await request(http())
      .patch(`/api/v1/elkstay/stays/${createdId}/verify`)
      .set('Authorization', asUser(adminToken))
      .send({ isVerified: true })
      .expect(200);

    // another provider's stay cannot be edited by this provider
    await request(http())
      .patch(`/api/v1/elkstay/stays/${createdId}`)
      .set('Authorization', asUser(providerToken))
      .send({ badge: 'Updated' })
      .expect(200);

    // soft delete hides it from listings
    await request(http())
      .delete(`/api/v1/elkstay/stays/${createdId}`)
      .set('Authorization', asUser(providerToken))
      .expect(200);
    await request(http())
      .get(`/api/v1/elkstay/stay/${createdId}`)
      .set('Authorization', asUser(userToken))
      .expect(404);
  });
});
