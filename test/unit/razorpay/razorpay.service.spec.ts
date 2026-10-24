import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ServicePaymentStatus } from '@prisma/client';
import { RazorpayClient } from '@/modules/razorpay/razorpay.client';
import { RefundScheduler } from '@/modules/razorpay/razorpay.queue';
import { RazorpayRepository } from '@/modules/razorpay/razorpay.repository';
import { RazorpayService } from '@/modules/razorpay/razorpay.service';

const KEY_SECRET = 'key-secret';
const WEBHOOK_SECRET = 'webhook-secret';
const sign = (secret: string, data: string) =>
  createHmac('sha256', secret).update(data).digest('hex');

const payment = {
  id: 'sp-1',
  bookingId: 'b-1',
  status: ServicePaymentStatus.CREATED,
  amount: 1944 as never,
  razorpayOrderId: 'order_1',
  razorpayPaymentId: null,
  method: null,
  refundAmount: null,
  razorpayRefundId: null,
  capturedAt: null,
  refundedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const paid = {
  id: 'pay_1',
  order_id: 'order_1',
  amount: 194400,
  currency: 'INR',
  status: 'captured' as const,
  method: 'upi',
};

describe('RazorpayService', () => {
  let svc: RazorpayService;
  let client: RazorpayClient;
  let repo: jest.Mocked<RazorpayRepository>;
  let refunds: jest.Mocked<RefundScheduler>;

  beforeEach(async () => {
    const config = {
      'razorpay.enabled': true,
      'razorpay.keyId': 'rzp_test_x',
      'razorpay.keySecret': KEY_SECRET,
      'razorpay.webhookSecret': WEBHOOK_SECRET,
    } as Record<string, unknown>;
    const moduleRef = await Test.createTestingModule({
      providers: [
        RazorpayService,
        RazorpayClient,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        {
          provide: RazorpayRepository,
          useValue: {
            create: jest.fn().mockResolvedValue(undefined),
            byBooking: jest.fn().mockResolvedValue(payment),
            byOrder: jest.fn().mockResolvedValue(payment),
            capture: jest.fn().mockResolvedValue(true),
            startRefund: jest.fn().mockResolvedValue(true),
            markRefunded: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RefundScheduler,
          useValue: { schedule: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    svc = moduleRef.get(RazorpayService);
    client = moduleRef.get(RazorpayClient);
    repo = moduleRef.get(RazorpayRepository);
    refunds = moduleRef.get(RefundScheduler);
    jest.spyOn(client, 'fetchPayment').mockResolvedValue(paid);
    jest.spyOn(client, 'capture').mockResolvedValue({ ...paid, status: 'captured' });
  });

  it('opens an order in paise and records it against the booking', async () => {
    jest.spyOn(client, 'createOrder').mockResolvedValue({ id: 'order_1' });
    const checkout = await svc.checkout({ id: 'b-1', code: 'ELK-S-AAAAA', total: 1944 });

    expect(client.createOrder).toHaveBeenCalledWith(194400, 'ELK-S-AAAAA', { bookingId: 'b-1' });
    expect(repo.create).toHaveBeenCalledWith('b-1', 1944, 'order_1');
    expect(checkout).toEqual({
      keyId: 'rzp_test_x',
      orderId: 'order_1',
      amount: 194400,
      currency: 'INR',
    });
  });

  describe('verify', () => {
    const dto = (signature: string) => ({
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: signature,
    });

    it('confirms the booking for a genuine checkout signature', async () => {
      await svc.verify('b-1', dto(sign(KEY_SECRET, 'order_1|pay_1')));
      expect(repo.capture).toHaveBeenCalledWith('order_1', 'pay_1', 'upi');
    });

    it('refuses a forged signature without asking Razorpay', async () => {
      await expect(
        svc.verify('b-1', dto(sign('wrong-secret', 'order_1|pay_1'))),
      ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_SIGNATURE' });
      expect(client.fetchPayment).not.toHaveBeenCalled();
      expect(repo.capture).not.toHaveBeenCalled();
    });

    it('refuses a payment for less than the booking costs', async () => {
      jest.spyOn(client, 'fetchPayment').mockResolvedValue({ ...paid, amount: 100 });
      await expect(svc.verify('b-1', dto(sign(KEY_SECRET, 'order_1|pay_1')))).rejects.toMatchObject(
        { code: 'PAYMENT_MISMATCH' },
      );
      expect(repo.capture).not.toHaveBeenCalled();
    });

    it('captures a payment Razorpay has only authorized', async () => {
      jest.spyOn(client, 'fetchPayment').mockResolvedValue({ ...paid, status: 'authorized' });
      await svc.verify('b-1', dto(sign(KEY_SECRET, 'order_1|pay_1')));
      expect(client.capture).toHaveBeenCalledWith('pay_1', 194400);
      expect(repo.capture).toHaveBeenCalled();
    });

    it('does nothing more for a payment the webhook already settled', async () => {
      repo.byBooking.mockResolvedValue({ ...payment, status: ServicePaymentStatus.CAPTURED });
      await svc.verify('b-1', dto(sign(KEY_SECRET, 'order_1|pay_1')));
      expect(client.fetchPayment).not.toHaveBeenCalled();
    });
  });

  describe('webhook', () => {
    const body = (event: object) => Buffer.from(JSON.stringify(event));

    it('settles a captured payment', async () => {
      const raw = body({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } },
      });
      await svc.handleWebhook(raw, sign(WEBHOOK_SECRET, raw.toString()));
      expect(repo.byOrder).toHaveBeenCalledWith('order_1');
      expect(repo.capture).toHaveBeenCalledWith('order_1', 'pay_1', 'upi');
    });

    it('rejects a body that was not signed with the webhook secret', async () => {
      const raw = body({ event: 'payment.captured', payload: {} });
      await expect(svc.handleWebhook(raw, sign('other', raw.toString()))).rejects.toMatchObject({
        code: 'INVALID_WEBHOOK_SIGNATURE',
      });
      await expect(svc.handleWebhook(raw, undefined)).rejects.toMatchObject({
        code: 'INVALID_WEBHOOK_SIGNATURE',
      });
    });

    it('marks a processed refund as refunded', async () => {
      const raw = body({
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } },
      });
      await svc.handleWebhook(raw, sign(WEBHOOK_SECRET, raw.toString()));
      expect(repo.markRefunded).toHaveBeenCalledWith({ razorpayRefundId: 'rfnd_1' });
    });
  });

  describe('refund', () => {
    it('queues a refund for a captured payment', async () => {
      await svc.refund('b-1', 1749.6);
      expect(repo.startRefund).toHaveBeenCalledWith('b-1', 1749.6);
      expect(refunds.schedule).toHaveBeenCalledWith('b-1');
    });

    it('queues nothing when there is no captured payment to refund', async () => {
      repo.startRefund.mockResolvedValue(false);
      await svc.refund('b-1', 1749.6);
      expect(refunds.schedule).not.toHaveBeenCalled();
    });
  });
});
