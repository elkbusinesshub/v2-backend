import { execSync } from 'node:child_process';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * Cleaning and rental requests end to end against real MySQL/Redis:
 * assignment, decline and retry, the buyer-only OTP, the five-try lock,
 * wallet payment at the OTP (cleaning) or at Complete (rental), and staff.
 */
describe('Service requests — cleaning & rental (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redis: StartedTestContainer;
  let app: NestExpressApplication;
  let prisma: ExtendedPrismaClient;

  let buyerId: string;
  let sellerAId: string;
  let sellerBId: string;
  let buyerToken: string;
  let sellerAToken: string;
  let sellerBToken: string;
  let issue: (userId: string) => Promise<string>;

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

    prisma = app.get<ExtendedPrismaClient>(PRISMA);
    const auth = app.get(AuthService);
    issue = async (userId: string) => {
      const user = await prisma.user.findFirstOrThrow({ where: { id: userId } });
      return (await auth.issueTokenPair(user, {})).accessToken;
    };

    const buyer = await prisma.user.findFirstOrThrow({ where: { phone: '+971500000002' } });
    const sellerA = await prisma.user.findFirstOrThrow({ where: { phone: '+971500000001' } });
    const sellerB = await prisma.user.create({
      data: { phone: '+919800000001', name: 'Partner B', roles: ['USER'] },
    });
    buyerId = buyer.id;
    sellerAId = sellerA.id;
    sellerBId = sellerB.id;

    // Both partners verified and online — the only kind that receives requests.
    for (const [userId, name] of [
      [sellerAId, 'Shine Services'],
      [sellerBId, 'Partner B'],
    ] as const) {
      await prisma.providerProfile.upsert({
        where: { userId },
        create: {
          userId,
          businessName: name,
          serviceCategory: 'Cleaning',
          contactNumber: '+919800000100',
          serviceArea: 'Bengaluru',
          status: 'VERIFIED',
          isAvailable: true,
        },
        update: { businessName: name, status: 'VERIFIED', isAvailable: true },
      });
    }

    [buyerToken, sellerAToken, sellerBToken] = await Promise.all([
      issue(buyerId),
      issue(sellerAId),
      issue(sellerBId),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([mysql?.stop(), redis?.stop()]);
  });

  const http = (): App => app.getHttpServer();
  const bearer = (t: string) => `Bearer ${t}`;
  const inDays = (days: number, hour = 10) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const setBalance = (userId: string, amount: number) =>
    prisma.user.update({ where: { id: userId }, data: { walletBalance: amount } });
  const balanceOf = async (userId: string) =>
    Number((await prisma.user.findFirstOrThrow({ where: { id: userId } })).walletBalance);

  const cleaningBody = {
    district: 'bengaluru_urban',
    serviceType: 'HOME_CLEANING',
    scheduledAt: inDays(2),
    addressText: '12, 4th Cross, Koramangala',
    lat: 12.9352,
    lng: 77.6245,
  };

  describe('cleaning', () => {
    let firstId: string;
    let retriedId: string;

    it('partners set their districts and prices', async () => {
      const a = await request(http())
        .patch('/api/v1/partner-setup/cleaning')
        .set('Authorization', bearer(sellerAToken))
        .send({
          districts: ['bengaluru_urban'],
          services: [{ serviceType: 'HOME_CLEANING', price: 1000 }],
        })
        .expect(200);
      expect(a.body.data.cleaning.services).toEqual([
        { serviceType: 'HOME_CLEANING', price: 1000 },
      ]);

      await request(http())
        .patch('/api/v1/partner-setup/cleaning')
        .set('Authorization', bearer(sellerBToken))
        .send({
          districts: ['bengaluru_urban', 'mysuru'],
          services: [{ serviceType: 'HOME_CLEANING', price: 1200 }],
        })
        .expect(200);

      await request(http())
        .patch('/api/v1/partner-setup/cleaning')
        .set('Authorization', bearer(sellerBToken))
        .send({ districts: ['atlantis'], services: [] })
        .expect(400);
    });

    it('refuses a request the wallet cannot pay for', async () => {
      await setBalance(buyerId, 0);
      const res = await request(http())
        .post('/api/v1/service-requests/cleaning')
        .set('Authorization', bearer(buyerToken))
        .send(cleaningBody)
        .expect(402);
      expect(res.body.error).toBe('INSUFFICIENT_BALANCE');
    });

    it('assigns the cheaper free partner, and shows no code while pending', async () => {
      await setBalance(buyerId, 5000);
      const res = await request(http())
        .post('/api/v1/service-requests/cleaning')
        .set('Authorization', bearer(buyerToken))
        .send(cleaningBody)
        .expect(201);
      expect(res.body.data).toMatchObject({
        kind: 'CLEANING',
        status: 'PENDING',
        amount: 1000,
        sellerName: 'Shine Services',
        districtName: 'Bengaluru Urban',
        otpCode: null,
      });
      firstId = res.body.data.id;
    });

    it('only the assigned partner can answer', async () => {
      await request(http())
        .post(`/api/v1/service-requests/${firstId}/accept`)
        .set('Authorization', bearer(sellerBToken))
        .send({})
        .expect(403);
    });

    it('a decline lets the buyer try again with the next partner', async () => {
      await request(http())
        .post(`/api/v1/service-requests/${firstId}/decline`)
        .set('Authorization', bearer(sellerAToken))
        .expect(200);

      const retry = await request(http())
        .post(`/api/v1/service-requests/${firstId}/retry`)
        .set('Authorization', bearer(buyerToken))
        .expect(201);
      expect(retry.body.data).toMatchObject({
        status: 'PENDING',
        sellerName: 'Partner B',
        amount: 1200,
      });
      retriedId = retry.body.data.id;

      // Partner B is now declining too: nobody is left.
      await request(http())
        .post(`/api/v1/service-requests/${retriedId}/decline`)
        .set('Authorization', bearer(sellerBToken))
        .expect(200);
      const none = await request(http())
        .post(`/api/v1/service-requests/${retriedId}/retry`)
        .set('Authorization', bearer(buyerToken))
        .expect(409);
      expect(none.body.error).toBe('NO_PARTNER_AVAILABLE');
    });

    it('on accept, only the buyer sees the six-digit code', async () => {
      const created = await request(http())
        .post('/api/v1/service-requests/cleaning')
        .set('Authorization', bearer(buyerToken))
        .send({ ...cleaningBody, scheduledAt: inDays(3) })
        .expect(201);
      retriedId = created.body.data.id;
      const assignedToken =
        created.body.data.sellerName === 'Partner B' ? sellerBToken : sellerAToken;

      const accepted = await request(http())
        .post(`/api/v1/service-requests/${retriedId}/accept`)
        .set('Authorization', bearer(assignedToken))
        .send({})
        .expect(200);
      expect(accepted.body.data.otpCode).toBeNull();
      expect(accepted.body.data.buyerPhone).toBeTruthy();

      const asBuyer = await request(http())
        .get(`/api/v1/service-requests/${retriedId}`)
        .set('Authorization', bearer(buyerToken))
        .expect(200);
      expect(asBuyer.body.data.status).toBe('ACCEPTED');
      expect(asBuyer.body.data.otpCode).toMatch(/^\d{6}$/);
    });

    it('locks after five wrong codes until the buyer gets a new one, then charges on a match', async () => {
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: retriedId } });
      const partnerToken = row.sellerId === sellerBId ? sellerBToken : sellerAToken;
      const wrong = row.otpCode === '000000' ? '111111' : '000000';

      for (let i = 1; i <= 4; i++) {
        const res = await request(http())
          .post(`/api/v1/service-requests/${retriedId}/verify-otp`)
          .set('Authorization', bearer(partnerToken))
          .send({ otpCode: wrong })
          .expect(400);
        expect(res.body.details[0].message).toContain(`${5 - i}`);
      }
      await request(http())
        .post(`/api/v1/service-requests/${retriedId}/verify-otp`)
        .set('Authorization', bearer(partnerToken))
        .send({ otpCode: wrong })
        .expect(423);
      // Even the right code is refused while locked.
      await request(http())
        .post(`/api/v1/service-requests/${retriedId}/verify-otp`)
        .set('Authorization', bearer(partnerToken))
        .send({ otpCode: row.otpCode })
        .expect(423);

      const fresh = await request(http())
        .post(`/api/v1/service-requests/${retriedId}/new-code`)
        .set('Authorization', bearer(buyerToken))
        .expect(200);
      const code = fresh.body.data.otpCode as string;
      expect(fresh.body.data.otpAttemptsLeft).toBe(5);

      const buyerBefore = await balanceOf(buyerId);
      const sellerBefore = await balanceOf(row.sellerId);
      const started = await request(http())
        .post(`/api/v1/service-requests/${retriedId}/verify-otp`)
        .set('Authorization', bearer(partnerToken))
        .send({ otpCode: code })
        .expect(200);
      expect(started.body.data).toMatchObject({
        status: 'IN_PROGRESS',
        isPaid: true,
        otpCode: null,
      });

      const price = Number(row.amount);
      expect(await balanceOf(buyerId)).toBe(buyerBefore - price);
      expect(await balanceOf(row.sellerId)).toBe(sellerBefore + price);

      const done = await request(http())
        .post(`/api/v1/service-requests/${retriedId}/complete`)
        .set('Authorization', bearer(partnerToken))
        .expect(200);
      expect(done.body.data.status).toBe('COMPLETED');
      expect(await balanceOf(buyerId)).toBe(buyerBefore - price);
    });

    it('rejects bad input and strangers', async () => {
      await request(http())
        .post('/api/v1/service-requests/cleaning')
        .set('Authorization', bearer(buyerToken))
        .send({ ...cleaningBody, district: 'atlantis' })
        .expect(400);
      await request(http())
        .post('/api/v1/service-requests/cleaning')
        .set('Authorization', bearer(buyerToken))
        .send({ ...cleaningBody, scheduledAt: '2020-01-01T10:00:00.000Z' })
        .expect(400);
      await request(http())
        .post('/api/v1/service-requests/cleaning')
        .send(cleaningBody)
        .expect(401);

      const stranger = await prisma.user.create({
        data: { phone: '+919800000077', roles: ['USER'] },
      });
      await request(http())
        .get(`/api/v1/service-requests/${retriedId}`)
        .set('Authorization', bearer(await issue(stranger.id)))
        .expect(403);
    });
  });

  describe('rental', () => {
    let staffToken: string;
    let staffRecordId: string;
    let rentalId: string;

    const rentalBody = {
      vehicleType: 'SUV',
      startAt: inDays(5),
      endAt: inDays(7),
      fulfilment: 'DELIVERY',
      addressText: 'MG Road, Bengaluru',
      lat: 12.9756,
      lng: 77.6066,
    };

    it('shops set their address, delivery fee and vehicles', async () => {
      // A is close to the buyer; B is in Mysuru.
      await request(http())
        .patch('/api/v1/partner-setup/rental')
        .set('Authorization', bearer(sellerAToken))
        .send({
          address: 'Shine Rentals, Indiranagar',
          lat: 12.9784,
          lng: 77.6408,
          deliveryFee: 300,
          vehicles: [{ vehicleType: 'SUV', quantity: 1, pricePerDay: 2000 }],
        })
        .expect(200);
      await request(http())
        .patch('/api/v1/partner-setup/rental')
        .set('Authorization', bearer(sellerBToken))
        .send({
          address: 'B Rentals, Mysuru',
          lat: 12.2958,
          lng: 76.6394,
          deliveryFee: 100,
          vehicles: [{ vehicleType: 'SUV', quantity: 3, pricePerDay: 1500 }],
        })
        .expect(200);
    });

    it('a seller adds a staff login', async () => {
      const res = await request(http())
        .post('/api/v1/partner-setup/staff')
        .set('Authorization', bearer(sellerAToken))
        .send({ name: 'Ravi', phone: '+919811111111' })
        .expect(201);
      staffRecordId = res.body.data.id;

      await request(http())
        .post('/api/v1/partner-setup/staff')
        .set('Authorization', bearer(sellerAToken))
        .send({ name: 'Ravi again', phone: '+919811111111' })
        .expect(409);

      const staffUser = await prisma.user.findFirstOrThrow({ where: { phone: '+919811111111' } });
      staffToken = await issue(staffUser.id);
      const of = await request(http())
        .get('/api/v1/partner-setup/staff-of')
        .set('Authorization', bearer(staffToken))
        .expect(200);
      expect(of.body.data).toEqual([
        { sellerId: sellerAId, sellerName: 'Shine Services', staffName: 'Ravi' },
      ]);
    });

    it('assigns the nearest shop with a free vehicle, priced per day plus delivery', async () => {
      await setBalance(buyerId, 20000);
      const res = await request(http())
        .post('/api/v1/service-requests/rental')
        .set('Authorization', bearer(buyerToken))
        .send(rentalBody)
        .expect(201);
      expect(res.body.data).toMatchObject({
        kind: 'RENTAL',
        sellerName: 'Shine Services',
        amount: 4000,
        feesAmount: 300,
        totalAmount: 4300,
        shopAddress: 'Shine Rentals, Indiranagar',
      });
      rentalId = res.body.data.id;

      // Shop A's only SUV is taken for those dates, so the next one goes to B.
      const second = await request(http())
        .post('/api/v1/service-requests/rental')
        .set('Authorization', bearer(buyerToken))
        .send({ ...rentalBody, fulfilment: 'PICKUP', startAt: inDays(6), endAt: inDays(8) })
        .expect(201);
      expect(second.body.data).toMatchObject({
        sellerName: 'Partner B',
        amount: 3000,
        feesAmount: 0,
      });

      const none = await request(http())
        .post('/api/v1/service-requests/rental')
        .set('Authorization', bearer(buyerToken))
        .send({ ...rentalBody, vehicleType: 'BIKE' })
        .expect(409);
      expect(none.body.error).toBe('NO_PARTNER_AVAILABLE');
    });

    it('staff on the job verify the handover; payment waits for Complete', async () => {
      await request(http())
        .post(`/api/v1/service-requests/${rentalId}/accept`)
        .set('Authorization', bearer(sellerAToken))
        .send({ staffId: staffRecordId })
        .expect(200);

      const jobs = await request(http())
        .get('/api/v1/service-requests/staff-jobs')
        .set('Authorization', bearer(staffToken))
        .expect(200);
      expect(jobs.body.data.map((j: { id: string }) => j.id)).toContain(rentalId);
      expect(jobs.body.data[0].otpCode).toBeNull();

      const code = (
        await request(http())
          .get(`/api/v1/service-requests/${rentalId}`)
          .set('Authorization', bearer(buyerToken))
          .expect(200)
      ).body.data.otpCode as string;

      const buyerBefore = await balanceOf(buyerId);
      const handedOver = await request(http())
        .post(`/api/v1/service-requests/${rentalId}/verify-otp`)
        .set('Authorization', bearer(staffToken))
        .send({ otpCode: code })
        .expect(200);
      expect(handedOver.body.data).toMatchObject({ status: 'IN_PROGRESS', isPaid: false });
      expect(await balanceOf(buyerId)).toBe(buyerBefore);

      const sellerBefore = await balanceOf(sellerAId);
      const done = await request(http())
        .post(`/api/v1/service-requests/${rentalId}/complete`)
        .set('Authorization', bearer(staffToken))
        .expect(200);
      expect(done.body.data).toMatchObject({ status: 'COMPLETED', isPaid: true });
      expect(await balanceOf(buyerId)).toBe(buyerBefore - 4300);
      expect(await balanceOf(sellerAId)).toBe(sellerBefore + 4300);
    });

    it('completing with too little in the wallet changes nothing', async () => {
      const res = await request(http())
        .post('/api/v1/service-requests/rental')
        .set('Authorization', bearer(buyerToken))
        .send({ ...rentalBody, startAt: inDays(20), endAt: inDays(21) })
        .expect(201);
      const id = res.body.data.id as string;
      await request(http())
        .post(`/api/v1/service-requests/${id}/accept`)
        .set('Authorization', bearer(sellerAToken))
        .send({})
        .expect(200);
      const code = (await prisma.serviceRequest.findUniqueOrThrow({ where: { id } })).otpCode!;
      await request(http())
        .post(`/api/v1/service-requests/${id}/verify-otp`)
        .set('Authorization', bearer(sellerAToken))
        .send({ otpCode: code })
        .expect(200);

      await setBalance(buyerId, 10);
      const fail = await request(http())
        .post(`/api/v1/service-requests/${id}/complete`)
        .set('Authorization', bearer(sellerAToken))
        .expect(402);
      expect(fail.body.error).toBe('INSUFFICIENT_BALANCE');
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('IN_PROGRESS');
      expect(row.paidAt).toBeNull();
      expect(await balanceOf(buyerId)).toBe(10);
    });

    it('a removed staff member loses access', async () => {
      await request(http())
        .delete(`/api/v1/partner-setup/staff/${staffRecordId}`)
        .set('Authorization', bearer(sellerBToken))
        .expect(403);
      await request(http())
        .delete(`/api/v1/partner-setup/staff/${staffRecordId}`)
        .set('Authorization', bearer(sellerAToken))
        .expect(204);
      const jobs = await request(http())
        .get('/api/v1/service-requests/staff-jobs')
        .set('Authorization', bearer(staffToken))
        .expect(200);
      expect(jobs.body.data).toEqual([]);
    });
  });
});
