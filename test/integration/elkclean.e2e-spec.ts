import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * ELK Clean module against real MySQL/Redis: home feed, catalog browse,
 * server-side cart pricing (promos), booking with address snapshot,
 * cancellation rules, and admin RBAC on management endpoints.
 */
describe('ElkClean (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;

  let userToken: string;
  let adminToken: string;
  let addressId: string;
  let sofaServiceId: string;

  /** Tomorrow in the operating region (+04:00) — always inside the window. */
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

  it('serves the home feed: 8 category tiles with counts + 3 offers', async () => {
    const res = await request(http())
      .get('/api/v1/elkclean/home')
      .set('Authorization', bearer(userToken))
      .expect(200);

    const feed = res.body.data;
    expect(feed.userName).toBe('Demo');
    expect(feed.categories).toHaveLength(8);
    const tank = feed.categories.find((c: { id: string }) => c.id === 'tnk');
    expect(tank).toMatchObject({ label: 'Water Tank', star: true, serviceCount: 3 });
    expect(feed.offers).toHaveLength(3);
    expect(feed.offers[0]).toMatchObject({ code: 'TANK60', unit: 'MINUTES' });
  });

  it('lists a category’s services with checklist and process steps', async () => {
    const res = await request(http())
      .get('/api/v1/elkclean/categories/tnk/services')
      .set('Authorization', bearer(userToken))
      .expect(200);

    const services = res.body.data;
    expect(services).toHaveLength(3);
    expect(services[0]).toMatchObject({ code: 'TNK-01', price: 149, tag: 'Featured' });
    expect(services[0].checklist).toContain('Cleanliness photo report');
    expect(services[0].steps).toEqual([
      'Inspect',
      'Drain',
      'Scrub',
      'Disinfect',
      'Refill',
      'Report',
    ]);

    const sofa = await request(http())
      .get('/api/v1/elkclean/categories/sof/services')
      .set('Authorization', bearer(userToken))
      .expect(200);
    sofaServiceId = sofa.body.data[0].id;
  });

  it('prices a cart server-side and applies the SOFA50 percent promo', async () => {
    const res = await request(http())
      .post('/api/v1/elkclean/quote')
      .set('Authorization', bearer(userToken))
      .send({ items: [{ serviceId: sofaServiceId, quantity: 4 }], promoCode: 'sofa50' })
      .expect(200);

    // 4 seats × 35 = 140; 50% off = 70; +10 supply fee
    expect(res.body.data.breakdown).toMatchObject({
      subtotal: 140,
      supplyFee: 10,
      promoCode: 'SOFA50',
      discountAmount: 70,
      totalAmount: 80,
    });
  });

  it('rejects an invalid promo code with a 400', async () => {
    await request(http())
      .post('/api/v1/elkclean/quote')
      .set('Authorization', bearer(userToken))
      .send({ items: [{ serviceId: sofaServiceId, quantity: 1 }], promoCode: 'BOGUS' })
      .expect(400);
  });

  it('books a clean against a saved address, ignoring any client total', async () => {
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
    addressId = addr.body.data.id;

    const options = await request(http())
      .get('/api/v1/elkclean/booking-options')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(options.body.data.timeSlots).toContain('18:00');
    expect(options.body.data.dates).toHaveLength(6);
    expect(options.body.data.addresses).toHaveLength(1);

    const payload = {
      items: [{ serviceId: sofaServiceId, quantity: 4 }],
      scheduledDate,
      timeSlot: '18:00',
      addressId,
      paymentMethod: 'card',
    };

    // a client-supplied total is not part of the contract — hard-rejected
    await request(http())
      .post('/api/v1/elkclean/bookings')
      .set('Authorization', bearer(userToken))
      .send({ ...payload, total: 1 })
      .expect(400);

    const res = await request(http())
      .post('/api/v1/elkclean/bookings')
      .set('Authorization', bearer(userToken))
      .send(payload)
      .expect(201);

    const booking = res.body.data;
    expect(booking.code).toMatch(/^ELC-\d{4}$/);
    expect(booking.status).toBe('confirmed');
    expect(booking.address.line).toBe('Tower 3, Apt 1204, Al Reem Island');
    expect(booking.breakdown.totalAmount).toBe(150); // 4×35 + 10, server-priced
    expect(booking.paidAt).not.toBeNull();
  });

  it('cancels >2h out, then refuses a second cancellation', async () => {
    const create = await request(http())
      .post('/api/v1/elkclean/bookings')
      .set('Authorization', bearer(userToken))
      .send({
        items: [{ serviceId: sofaServiceId, quantity: 1 }],
        scheduledDate,
        timeSlot: '16:00',
        addressId,
        paymentMethod: 'wallet',
      })
      .expect(201);
    const id = create.body.data.id;

    await request(http())
      .post(`/api/v1/elkclean/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(200);

    await request(http())
      .post(`/api/v1/elkclean/bookings/${id}/cancel`)
      .set('Authorization', bearer(userToken))
      .expect(409);

    const list = await request(http())
      .get('/api/v1/elkclean/bookings')
      .set('Authorization', bearer(userToken))
      .expect(200);
    const cancelled = list.body.data.find((b: { id: string }) => b.id === id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('enforces admin RBAC on catalog management, then serves the new service', async () => {
    const dto = {
      categorySlug: 'tnk',
      name: 'Rooftop Tank Inspection',
      description: 'Visual inspection with photo report.',
      price: 49,
      durationLabel: '30 min',
      checklist: ['Visual inspection', 'Photo report'],
    };

    await request(http())
      .post('/api/v1/elkclean/services')
      .set('Authorization', bearer(userToken))
      .send(dto)
      .expect(403);

    const created = await request(http())
      .post('/api/v1/elkclean/services')
      .set('Authorization', bearer(adminToken))
      .send(dto)
      .expect(201);
    expect(created.body.data.code).toBe('TNK-04');

    const updated = await request(http())
      .patch(`/api/v1/elkclean/services/${created.body.data.id}`)
      .set('Authorization', bearer(adminToken))
      .send({ isActive: false })
      .expect(200);
    expect(updated.body.data.isActive).toBe(false);

    // deactivated services disappear from the public catalog
    const list = await request(http())
      .get('/api/v1/elkclean/categories/tnk/services')
      .set('Authorization', bearer(userToken))
      .expect(200);
    expect(list.body.data).toHaveLength(3);
  });

  it('requires auth on every elkclean route', async () => {
    await request(http()).get('/api/v1/elkclean/home').expect(401);
    await request(http()).post('/api/v1/elkclean/bookings').expect(401);
  });
});
