import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { UnifiedBookingsRepository } from './unified-bookings.repository';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, UnifiedBookingsRepository],
})
export class BookingsModule {}
