import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Car Rental module against real MySQL/Redis: catalog + filters, the
 * quote formula, availability-checked booking (incl. overlap conflict),
 * cancellation window, pickup/return transitions with RBAC.
 */
describe('Rentals (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let providerToken: string;
  let carId: string;
  let branchId: string;

  function range(startDays: number, lengthDays: number): { pickupAt: string; returnAt: string } {
    const pickup = new Date();
    pickup.setUTCDate(pickup.getUTCDate() + startDays);
    pickup.setUTCHours(10, 0, 0, 0);
    return {
      pickupAt: pickup.toISOString(),
      returnAt: new Date(pickup.getTime() + lengthDays * 86_400_000).toISOString(),
    };
  }

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

    const [user, provider] = await Promise.all([
      prisma.user.findFirst({ where: { phone: '+971500000001' } }),
      prisma.user.findFirst({ where: { phone: '+971500000002' } }),
    ]);
    userToken = (await auth.issueTokenPair(user!, {})).accessToken;
    providerToken = (await auth.issueTokenPair(provider!, {})).accessToken;

    carId = (await prisma.rentalCar.findUnique({ where: { slug: 'toyota-camry' } }))!.id;
    branchId = (await prisma.rentalBranch.findUnique({ where: { slug: 'corniche' } }))!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();

  it('lists cars sorted by price with category filter and both wire formats', async () => {
    const all = await request(http())
      .get('/api/v1/rentals/cars')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(all.body.data).toHaveLength(6);
    // price ascending: Honda Civic (179) first
    expect(all.body.data[0]).toMatchObject({
      name: 'Honda Civic',
      type: 'Sedan',
      category: 'sedan',
      icon: '🚗',
      isBestDeal: false,
    });

    const luxury = await request(http())
      .get('/api/v1/rentals/cars?category=luxury')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(luxury.body.data.map((c: { name: string }) => c.name)).toEqual([
      'BMW 5 Series',
      'Mercedes E-Class',
    ]);
  });

  it('serves branches and extras catalogs', async () => {
    const branches = await request(http())
      .get('/api/v1/rentals/branches')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(branches.body.data).toHaveLength(3);

    const extras = await request(http())
      .get('/api/v1/rentals/extras')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(extras.body.data.map((e: { key: string }) => e.key).sort()).toEqual([
      'driver',
      'protection',
      'seat',
      'wifi',
    ]);
  });

  it('quotes the exact checkout formula from the app', async () => {
    const res = await request(http())
      .post('/api/v1/rentals/quote')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        carId,
        rentalType: 'weekly',
        ...range(1, 3),
        fulfilment: 'delivery',
        deliveryAddress: 'Al Reem Island, Abu Dhabi',
        extras: ['protection', 'wifi'],
        promoCode: 'ELK10',
      })
      .expect(200);

    expect(res.body.data.breakdown).toEqual({
      days: 3,
      dailyRate: 169,
      rentalTotal: 507,
      deliveryFee: 25,
      extrasTotal: 120,
      subtotal: 652,
      promoCode: 'ELK10',
      promoDiscount: 65,
      vatAmount: 29,
      totalAmount: 616,
    });
  });

  it('books an available car, then blocks the overlapping period', async () => {
    const body = {
      carId,
      rentalType: 'daily',
      ...range(10, 3),
      fulfilment: 'pickup',
      branchId,
      paymentMethod: 'card',
      agreedToTerms: true,
    };

    const created = await request(http())
      .post('/api/v1/rentals/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send(body)
      .expect(201);
    expect(created.body.data.code).toMatch(/^ELK-\d{5}$/);
    expect(created.body.data.status).toBe('confirmed');

    // availability endpoint agrees
    const avail = await request(http())
      .get(`/api/v1/rentals/cars/${carId}/availability`)
      .query({ from: body.pickupAt, to: body.returnAt })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(avail.body.data.available).toBe(false);

    // overlapping attempt (shifted 1 day into the booked window) → 409
    const overlap = await request(http())
      .post('/api/v1/rentals/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...body, ...range(11, 3) })
      .expect(409);
    expect(overlap.body.error).toBe('CAR_UNAVAILABLE');

    // a different, non-overlapping window books fine
    await request(http())
      .post('/api/v1/rentals/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...body, ...range(20, 2) })
      .expect(201);
  });

  it('requires the terms checkbox server-side', async () => {
    const res = await request(http())
      .post('/api/v1/rentals/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        carId,
        rentalType: 'daily',
        ...range(30, 2),
        fulfilment: 'pickup',
        branchId,
        paymentMethod: 'card',
        agreedToTerms: false,
      })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('runs the full lifecycle: cancel window, pickup RBAC, return', async () => {
    // fresh booking on a different car to keep windows independent
    const { PRISMA } = await import('@/database/prisma.constants');
    const prisma = app.get<import('@/database/prisma.extension').ExtendedPrismaClient>(PRISMA);
    const civic = (await prisma.rentalCar.findUnique({ where: { slug: 'honda-civic' } }))!;

    const make = (startDays: number) =>
      request(http())
        .post('/api/v1/rentals/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          carId: civic.id,
          rentalType: 'daily',
          ...range(startDays, 2),
          fulfilment: 'pickup',
          branchId,
          paymentMethod: 'cash',
          agreedToTerms: true,
        })
        .expect(201);

    // 1. free cancellation before pickup
    const toCancel = (await make(5)).body.data;
    await request(http())
      .post(`/api/v1/rentals/bookings/${toCancel.id}/cancel`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // 2. customer cannot confirm pickup (RBAC)
    const toRide = (await make(5)).body.data; // freed window after cancellation
    await request(http())
      .post(`/api/v1/rentals/bookings/${toRide.id}/pickup`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    // 3. provider confirms pickup → active; cancel now fails (409)
    const active = await request(http())
      .post(`/api/v1/rentals/bookings/${toRide.id}/pickup`)
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);
    expect(active.body.data.status).toBe('active');

    await request(http())
      .post(`/api/v1/rentals/bookings/${toRide.id}/cancel`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    // 4. provider confirms return → completed, no late fee (returned early)
    const done = await request(http())
      .post(`/api/v1/rentals/bookings/${toRide.id}/return`)
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);
    expect(done.body.data.status).toBe('completed');
    expect(done.body.data.breakdown.lateFee).toBe(0);

    // 5. double return is an invalid transition
    await request(http())
      .post(`/api/v1/rentals/bookings/${toRide.id}/return`)
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(409);
  });
});
