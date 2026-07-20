import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * ELK Porter module against real MySQL/Redis: options payload (legacy
 * route card included), server-side fare math (fils-exact VAT), ASAP and
 * scheduled bookings, the delivery lifecycle, and admin RBAC.
 */
describe('Porter (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;

  /** Tomorrow in the operating region (+04:00) — always inside the horizon. */
  const scheduledDate = new Date(Date.now() + 4 * 3_600_000 + 86_400_000)
    .toISOString()
    .slice(0, 10);

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

  it('serves /porter/options with vehicles, add-ons and the legacy route card', async () => {
    const res = await request(http())
      .get('/api/v1/porter/options')
      .set('Authorization', bearer(userToken))
      .expect(200);

    const options = res.body.data;
    expect(options.vehicles).toHaveLength(3);
    // legacy PorterVehicleModel contract: id/emoji/name/capacity
    expect(options.vehicles[0]).toMatchObject({
      id: 'bike',
      emoji: '🏍️',
      name: 'Bike',
      capacity: 'Up to 5 kg',
      baseFare: 35,
      badge: 'FASTEST',
    });
    expect(options.addons).toHaveLength(3);
    expect(options.pickupWindows).toHaveLength(4);
    // legacy PorterRouteModel contract
    expect(options.route).toMatchObject({
      pickupLabel: 'Pickup Location',
      estimatedFare: 35,
      distanceKm: 4.2,
    });
  });

  it('prices a fare server-side with fils-exact VAT', async () => {
    const res = await request(http())
      .post('/api/v1/porter/quote')
      .set('Authorization', bearer(userToken))
      .send({ vehicleId: 'truck', addons: ['helper', 'fragile'] })
      .expect(200);

    // 180 + 45 + 3.5 = 228.5; VAT 5% = 11.43 (rounded from 11.425); total 239.93
    expect(res.body.data.breakdown).toEqual({
      baseFare: 180,
      addonsTotal: 45,
      serviceFee: 3.5,
      vatAmount: 11.43,
      totalAmount: 239.93,
    });
  });

  it('books an ASAP delivery and lists it', async () => {
    const res = await request(http())
      .post('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        vehicleId: 'bike',
        pickupAddress: 'Dubai Marina, Block C',
        dropAddress: 'Downtown Dubai, Tower 4',
        packageType: 'Electronics',
        weightLabel: '2.5 kg',
        paymentMethod: 'wallet',
      })
      .expect(201);

    const booking = res.body.data;
    expect(booking.code).toMatch(/^ELK-\d{4}-[A-Z]{2}$/);
    expect(booking.status).toBe('confirmed');
    expect(booking.scheduledAt).toBeNull();
    expect(booking.breakdown.totalAmount).toBe(40.43); // 35 + 3.5 + 1.93
    expect(booking.paidAt).not.toBeNull();

    const list = await request(http())
      .get('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(list.body.data.some((b: { id: string }) => b.id === booking.id)).toBe(true);
  });

  it('runs the delivery lifecycle with admin RBAC: pickup → deliver', async () => {
    const create = await request(http())
      .post('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        vehicleId: 'car',
        addons: ['insure'],
        pickupAddress: 'JLT Cluster D',
        dropAddress: 'Business Bay, Bay Square',
        scheduledDate,
        pickupWindow: '9:00 – 10:00',
        paymentMethod: 'card',
      })
      .expect(201);
    const id = create.body.data.id;
    expect(create.body.data.pickupWindow).toBe('9:00 – 10:00');
    expect(create.body.data.scheduledAt).not.toBeNull();

    // users cannot drive fulfilment
    await request(http())
      .post(`/api/v1/porter/bookings/${id}/pickup`)
      .set('Authorization', bearer(userToken))
      .expect(403);

    // deliver before pickup is an invalid transition
    await request(http())
      .post(`/api/v1/porter/bookings/${id}/deliver`)
      .set('Authorization', bearer(adminToken))
      .expect(409);

    const picked = await request(http())
      .post(`/api/v1/porter/bookings/${id}/pickup`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(picked.body.data.status).toBe('picked_up');

    // no cancelling once the rider has the package
    await request(http())
      .post(`/api/v1/porter/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);

    const delivered = await request(http())
      .post(`/api/v1/porter/bookings/${id}/deliver`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(delivered.body.data.status).toBe('delivered');
    expect(delivered.body.data.deliveredAt).not.toBeNull();
  });

  it('cancels a confirmed booking, then refuses a second cancellation', async () => {
    const create = await request(http())
      .post('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        vehicleId: 'bike',
        pickupAddress: 'Al Barsha, Mall of the Emirates',
        dropAddress: 'Dubai Internet City',
        paymentMethod: 'cash',
      })
      .expect(201);
    const id = create.body.data.id;

    await request(http())
      .post(`/api/v1/porter/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    await request(http())
      .post(`/api/v1/porter/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);
  });

  it('rejects invalid input: unknown vehicle, bad window, missing addresses', async () => {
    await request(http())
      .post('/api/v1/porter/quote')
      .set('Authorization', bearer(userToken))
      .send({ vehicleId: 'jetpack' })
      .expect(400);

    await request(http())
      .post('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        vehicleId: 'bike',
        pickupAddress: 'A',
        dropAddress: 'B',
        scheduledDate, // window missing → invalid schedule pair
        paymentMethod: 'wallet',
      })
      .expect(400);

    await request(http())
      .post('/api/v1/porter/bookings')
      .set('Authorization', bearer(userToken))
      .send({ vehicleId: 'bike', paymentMethod: 'wallet' })
      .expect(400);
  });

  it('requires auth on every porter route', async () => {
    await request(http()).get('/api/v1/porter/options').expect(401);
    await request(http()).post('/api/v1/porter/bookings').expect(401);
  });
});
