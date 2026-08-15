import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DriverService } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { OFFER_WINDOW_SECONDS } from './dispatch.constants';
import { DispatchGateway } from './dispatch.gateway';
import { DispatchRepository } from './dispatch.repository';

export const DISPATCH_QUEUE = 'dispatch';
const OFFER_EXPIRED = 'offer-expired';

interface OfferExpiredJob {
  bookingId: string;
  service: DriverService;
}

/**
 * Closes an offer nobody answered.
 *
 * A delayed queue job rather than a `setTimeout`: a timer lives inside one
 * process, so a deploy or a crash mid-window would leave the request SEARCHING
 * forever and the rider watching a spinner with nothing behind it. BullMQ keeps
 * the deadline in Redis, where a restart — or another instance — still honours
 * it.
 */
@Injectable()
export class DispatchScheduler {
  constructor(@InjectQueue(DISPATCH_QUEUE) private readonly queue: Queue) {}

  async scheduleExpiry(bookingId: string, service: DriverService): Promise<void> {
    await this.queue.add(OFFER_EXPIRED, { bookingId, service } satisfies OfferExpiredJob, {
      delay: OFFER_WINDOW_SECONDS * 1000,
      // Keyed by booking so a retry or a double-request cannot queue the
      // same deadline twice. Dashes, not colons — BullMQ rejects a custom
      // job id containing one.
      jobId: `${OFFER_EXPIRED}-${bookingId}`,
    });
  }
}

@Processor(DISPATCH_QUEUE)
export class DispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    private readonly drivers: DispatchRepository,
    private readonly gateway: DispatchGateway,
  ) {
    super();
  }

  async process(job: Job<OfferExpiredJob>): Promise<void> {
    const { bookingId, service } = job.data;
    // Conditional on still being SEARCHING: a partner who accepted seconds
    // before the deadline must not have the job pulled out from under them.
    const expired =
      service === DriverService.RIDE
        ? await this.drivers.expireRideOffer(bookingId)
        : await this.drivers.expirePorterOffer(bookingId);

    if (!expired) return;

    this.logger.log(`offer window closed unanswered: ${service} ${bookingId}`);
    this.gateway.emitTrip(bookingId, 'trip:no_drivers', {
      message: 'No partners are available right now',
    });
  }
}
