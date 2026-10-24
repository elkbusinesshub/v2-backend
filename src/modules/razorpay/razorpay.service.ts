import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ServicePaymentStatus, type ServicePayment } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { RazorpayClient, toPaise, type RazorpayPayment } from './razorpay.client';
import type { RazorpayCheckoutDto, VerifyRazorpayPaymentDto } from './razorpay.dto';
import { RefundScheduler } from './razorpay.queue';
import { RazorpayRepository } from './razorpay.repository';

interface WebhookEvent {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string } };
    refund?: { entity: { id: string; payment_id: string } };
  };
}

/**
 * Razorpay for ELK's cleaning and repair bookings: an order per booking, the
 * payment confirmed by the app's verify call or the webhook (whichever comes
 * first), and refunds on cancel.
 *
 * Razorpay is the source of truth for whether money moved: a payment is only
 * marked captured after fetching it from Razorpay and checking its order and
 * amount, never on the strength of what a client or a webhook body says.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(
    private readonly client: RazorpayClient,
    private readonly payments: RazorpayRepository,
    private readonly refunds: RefundScheduler,
  ) {}

  get enabled(): boolean {
    return this.client.enabled;
  }

  /** Opens a Razorpay order for a booking and returns what the app's checkout needs. */
  async checkout(booking: {
    id: string;
    code: string;
    total: number;
  }): Promise<RazorpayCheckoutDto> {
    const amount = toPaise(booking.total);
    const order = await this.client.createOrder(amount, booking.code, { bookingId: booking.id });
    await this.payments.create(booking.id, booking.total, order.id);
    return { keyId: this.client.keyId, orderId: order.id, amount, currency: 'INR' };
  }

  /** The app's report of a successful checkout. Confirms the booking if the signature holds. */
  async verify(bookingId: string, dto: VerifyRazorpayPaymentDto): Promise<void> {
    const payment = await this.payments.byBooking(bookingId);
    if (!payment || payment.razorpayOrderId !== dto.razorpayOrderId) {
      throw new ResourceNotFoundException('Payment');
    }
    if (
      !this.client.isValidPaymentSignature(
        dto.razorpayOrderId,
        dto.razorpayPaymentId,
        dto.razorpaySignature,
      )
    ) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'INVALID_PAYMENT_SIGNATURE',
        'This payment could not be verified',
      );
    }
    await this.settle(payment, dto.razorpayPaymentId);
  }

  /** A Razorpay webhook. Throws on a bad signature or a failure, so Razorpay retries. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    if (!rawBody || !signature || !this.client.isValidWebhookSignature(rawBody, signature)) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'INVALID_WEBHOOK_SIGNATURE',
        'Invalid signature',
      );
    }
    const { event, payload } = JSON.parse(rawBody.toString('utf8')) as WebhookEvent;

    switch (event) {
      case 'payment.authorized':
      case 'payment.captured': {
        const entity = payload.payment!.entity;
        const payment = await this.payments.byOrder(entity.order_id);
        // Not one of ours (another product on the same account).
        if (payment) await this.settle(payment, entity.id);
        return;
      }
      case 'refund.processed':
        await this.payments.markRefunded({ razorpayRefundId: payload.refund!.entity.id });
        return;
      case 'refund.failed':
        // Left REFUND_PENDING for someone to resolve from the Razorpay dashboard.
        this.logger.error(
          { refundId: payload.refund!.entity.id, paymentId: payload.refund!.entity.payment_id },
          'razorpay refund failed',
        );
        return;
      default:
        return;
    }
  }

  /**
   * Refunds [amount] rupees of a booking's captured payment, once. A no-op for
   * a booking with no captured Razorpay payment (wallet, or never paid).
   */
  async refund(bookingId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    if (await this.payments.startRefund(bookingId, amount)) {
      await this.refunds.schedule(bookingId);
    }
  }

  /** Checks the payment with Razorpay, captures it if only authorized, and confirms the booking. */
  private async settle(payment: ServicePayment, paymentId: string): Promise<void> {
    if (payment.status !== ServicePaymentStatus.CREATED) return;

    const expected = toPaise(Number(payment.amount));
    let paid = await this.client.fetchPayment(paymentId);
    if (
      paid.order_id !== payment.razorpayOrderId ||
      paid.amount !== expected ||
      paid.currency !== 'INR'
    ) {
      this.logger.error(
        { paymentId, orderId: payment.razorpayOrderId, amount: paid.amount, expected },
        'razorpay payment does not match its booking',
      );
      throw new DomainException(
        HttpStatus.CONFLICT,
        'PAYMENT_MISMATCH',
        'This payment does not match the booking',
      );
    }
    if (paid.status === 'authorized') {
      paid = await this.captureOnce(paid, expected);
    }
    if (paid.status !== 'captured') {
      throw new DomainException(
        HttpStatus.PAYMENT_REQUIRED,
        'PAYMENT_NOT_COMPLETED',
        'The payment has not gone through yet',
      );
    }
    if (await this.payments.capture(payment.razorpayOrderId, paid.id, paid.method)) {
      this.logger.log(`booking ${payment.bookingId} paid (${paid.method}, ${paid.id})`);
    }
  }

  /** The verify call and the webhook can both try to capture; the loser re-reads instead of failing. */
  private async captureOnce(paid: RazorpayPayment, paise: number): Promise<RazorpayPayment> {
    try {
      return await this.client.capture(paid.id, paise);
    } catch (err) {
      const now = await this.client.fetchPayment(paid.id);
      if (now.status === 'captured') return now;
      throw err;
    }
  }
}
