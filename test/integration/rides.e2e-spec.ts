import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Rides (Taxi) module against real MySQL/Redis: the legacy /rides/types,
 * /rides/current-estimate and /rides/request contract, saved-address
 * pickup/drop, and the full trip lifecycle (OTP start, complete, rate+tip,
 * cancellation rules).
 */
describe('Rides (integration)', () => {
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

  it('serves the legacy /rides/types and /rides/current-estimate contract', async () => {
    const types = await request(http())
      .get('/api/v1/rides/types')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(types.body.data).toHaveLength(4);
    expect(types.body.data[0]).toMatchObject({ id: 'auto', emoji: '🛺', name: 'Auto', price: 8 });

    const estimate = await request(http())
      .get('/api/v1/rides/current-estimate')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(estimate.body.data).toMatchObject({ etaMinutes: 14, distanceKm: 8.2 });
  });

  it('previews a driver match via /rides/request without creating a booking', async () => {
    const res = await request(http())
      .post('/api/v1/rides/request')
      .set('Authorization', bearer(userToken))
      .send({ rideTypeId: 'economy' })
      .expect(200);
    expect(res.body.data).toHaveProperty('driverName');
    expect(res.body.data).toHaveProperty('plateNumber');

    const list = await request(http())
      .get('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('books against a saved address id, ignoring free text for that side', async () => {
    const addr = await request(http())
      .post('/api/v1/locations')
      .set('Authorization', bearer(userToken))
      .send({
        label: 'Home',
        formattedAddress: 'Tower 3, Apt 1204, Al Reem Island',
        lat: 24.494,
        lng: 54.407,
        isDefault: true,
      })
      .expect(201);

    const res = await request(http())
      .post('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        rideTypeId: 'premium',
        pickupAddressId: addr.body.data.id,
        dropAddress: 'Downtown Dubai · Burj Khalifa',
        paymentMethod: 'card',
      })
      .expect(201);

    const booking = res.body.data;
    expect(booking.pickupAddress).toBe('Tower 3, Apt 1204, Al Reem Island');
    expect(booking.status).toBe('confirmed');
    expect(booking.breakdown.totalAmount).toBe(28);
    expect(booking.otpCode).toMatch(/^\d{4}$/);
  });

  it("404s a pickupAddressId that isn't the caller's", async () => {
    await request(http())
      .post('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        rideTypeId: 'auto',
        pickupAddressId: '00000000-0000-7000-8000-000000000000',
        dropAddress: 'Downtown Dubai · Burj Khalifa',
        paymentMethod: 'cash',
      })
      .expect(404);
  });

  it('rejects a booking with neither dropAddress nor dropAddressId', async () => {
    await request(http())
      .post('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .send({ rideTypeId: 'auto', pickupAddress: 'Dubai Marina · Gate 3', paymentMethod: 'cash' })
      .expect(400);
  });

  it('runs the full trip lifecycle: wrong OTP, correct OTP, complete, rate+tip', async () => {
    const create = await request(http())
      .post('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        rideTypeId: 'auto',
        pickupAddress: 'Dubai Marina · Gate 3',
        dropAddress: 'Downtown Dubai · Burj Khalifa',
        paymentMethod: 'cash',
      })
      .expect(201);
    const { id, otpCode } = create.body.data;

    // trip can't complete before it starts
    await request(http())
      .post(`/api/v1/rides/bookings/${id}/complete`)
      .set('Authorization', bearer(userToken))
      .expect(409);

    // wrong OTP is rejected
    await request(http())
      .post(`/api/v1/rides/bookings/${id}/start`)
      .set('Authorization', bearer(userToken))
      .send({ otpCode: '0000' })
      .expect(400);

    const started = await request(http())
      .post(`/api/v1/rides/bookings/${id}/start`)
      .set('Authorization', bearer(userToken))
      .send({ otpCode })
      .expect(200);
    expect(started.body.data.status).toBe('in_progress');
    expect(started.body.data.otpCode).toBeNull(); // hidden once the trip starts

    // no cancelling a ride already underway
    await request(http())
      .post(`/api/v1/rides/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);

    const completed = await request(http())
      .post(`/api/v1/rides/bookings/${id}/complete`)
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(completed.body.data.status).toBe('completed');

    const rated = await request(http())
      .post(`/api/v1/rides/bookings/${id}/rate`)
      .set('Authorization', bearer(userToken))
      .send({ stars: 5, tip: 10 })
      .expect(201);
    expect(rated.body.data.ratingStars).toBe(5);
    expect(rated.body.data.tipAmount).toBe(10);

    // rating twice is rejected
    await request(http())
      .post(`/api/v1/rides/bookings/${id}/rate`)
      .set('Authorization', bearer(userToken))
      .send({ stars: 3 })
      .expect(409);
  });

  it('cancels a confirmed ride before it starts', async () => {
    const create = await request(http())
      .post('/api/v1/rides/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        rideTypeId: 'xl',
        pickupAddress: 'Al Barsha, Mall of the Emirates',
        dropAddress: 'Dubai Internet City',
        paymentMethod: 'wallet',
      })
      .expect(201);

    await request(http())
      .post(`/api/v1/rides/bookings/${create.body.data.id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    await request(http())
      .post(`/api/v1/rides/bookings/${create.body.data.id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);
  });

  it('requires auth on every rides route', async () => {
    await request(http()).get('/api/v1/rides/types').expect(401);
    await request(http()).post('/api/v1/rides/bookings').expect(401);
  });
});
