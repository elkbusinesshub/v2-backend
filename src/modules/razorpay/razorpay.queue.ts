import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ServicePaymentStatus } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { RazorpayClient, toPaise } from './razorpay.client';
import { RazorpayRepository } from './razorpay.repository';

export const RAZORPAY_QUEUE = 'razorpay';
const REFUND = 'refund';

interface RefundJob {
  bookingId: string;
}

/**
 * Asks Razorpay for a refund outside the cancel request.
 *
 * The booking is already cancelled by the time this runs, so a Razorpay outage
 * must not fail the cancel, and must not lose the refund either. A queue job
 * keeps it in Redis and retries with backoff (JobsModule's defaults).
 */
@Injectable()
export class RefundScheduler {
  constructor(@InjectQueue(RAZORPAY_QUEUE) private readonly queue: Queue) {}

  async schedule(bookingId: string): Promise<void> {
    await this.queue.add(REFUND, { bookingId } satisfies RefundJob, {
      jobId: `${REFUND}-${bookingId}`,
    });
  }
}

@Processor(RAZORPAY_QUEUE)
export class RefundProcessor extends WorkerHost {
  private readonly logger = new Logger(RefundProcessor.name);

  constructor(
    private readonly payments: RazorpayRepository,
    private readonly razorpay: RazorpayClient,
  ) {
    super();
  }

  async process(job: Job<RefundJob>): Promise<void> {
    const { bookingId } = job.data;
    const payment = await this.payments.byBooking(bookingId);
    // Asked for already: a retry after the request went through must not
    // refund twice. (Razorpay would refuse a second one past the captured
    // amount anyway.)
    if (
      !payment ||
      payment.status !== ServicePaymentStatus.REFUND_PENDING ||
      payment.razorpayRefundId ||
      !payment.razorpayPaymentId ||
      !payment.refundAmount
    ) {
      return;
    }
    const refund = await this.razorpay.refund(
      payment.razorpayPaymentId,
      toPaise(Number(payment.refundAmount)),
      { bookingId },
    );
    await this.payments.setRefundId(bookingId, refund.id);
    if (refund.status === 'processed') {
      await this.payments.markRefunded({ bookingId });
    }
    this.logger.log(`refund ${refund.id} (${refund.status}) for booking ${bookingId}`);
  }
}
