import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RazorpayClient } from './razorpay.client';
import { RazorpayController } from './razorpay.controller';
import { RAZORPAY_QUEUE, RefundProcessor, RefundScheduler } from './razorpay.queue';
import { RazorpayRepository } from './razorpay.repository';
import { RazorpayService } from './razorpay.service';

/** Razorpay checkout and refunds for ELK's cleaning and repair bookings. */
@Module({
  imports: [BullModule.registerQueue({ name: RAZORPAY_QUEUE })],
  controllers: [RazorpayController],
  providers: [
    RazorpayClient,
    RazorpayRepository,
    RazorpayService,
    RefundScheduler,
    RefundProcessor,
  ],
  exports: [RazorpayService],
})
export class RazorpayModule {}
