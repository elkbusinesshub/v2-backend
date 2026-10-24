import { Inject, Injectable } from '@nestjs/common';
import { ServiceBookingStatus, ServicePaymentStatus, type ServicePayment } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

const { CREATED, CAPTURED, REFUND_PENDING, REFUNDED } = ServicePaymentStatus;

/** Razorpay payments for ELK's cleaning and repair bookings. */
@Injectable()
export class RazorpayRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async create(bookingId: string, amount: number, razorpayOrderId: string): Promise<void> {
    await this.db.servicePayment.create({ data: { bookingId, amount, razorpayOrderId } });
  }

  async byBooking(bookingId: string): Promise<ServicePayment | null> {
    return this.db.servicePayment.findUnique({ where: { bookingId } });
  }

  async byOrder(razorpayOrderId: string): Promise<ServicePayment | null> {
    return this.db.servicePayment.findUnique({ where: { razorpayOrderId } });
  }

  /**
   * Marks the payment captured and releases its booking to the admin, both or
   * neither. Only from CREATED, so the checkout's verify call and the webhook
   * racing each other confirm it once. False when it was already settled.
   */
  async capture(razorpayOrderId: string, razorpayPaymentId: string, method: string) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.servicePayment.updateMany({
        where: { razorpayOrderId, status: CREATED },
        data: { status: CAPTURED, razorpayPaymentId, method, capturedAt: new Date() },
      });
      if (count === 0) return false;
      const { bookingId } = await tx.servicePayment.findUniqueOrThrow({
        where: { razorpayOrderId },
      });
      await tx.serviceBooking.updateMany({
        where: { id: bookingId, status: ServiceBookingStatus.AWAITING_PAYMENT },
        data: { status: ServiceBookingStatus.PENDING },
      });
      return true;
    });
  }

  /** Claims the refund: only a captured payment, and only once. */
  async startRefund(bookingId: string, refundAmount: number): Promise<boolean> {
    const { count } = await this.db.servicePayment.updateMany({
      where: { bookingId, status: CAPTURED },
      data: { status: REFUND_PENDING, refundAmount },
    });
    return count === 1;
  }

  async setRefundId(bookingId: string, razorpayRefundId: string): Promise<void> {
    await this.db.servicePayment.update({ where: { bookingId }, data: { razorpayRefundId } });
  }

  async markRefunded(where: { bookingId: string } | { razorpayRefundId: string }): Promise<void> {
    await this.db.servicePayment.updateMany({
      where: { ...where, status: REFUND_PENDING },
      data: { status: REFUNDED, refundedAt: new Date() },
    });
  }
}
