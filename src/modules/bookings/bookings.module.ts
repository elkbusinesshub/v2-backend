import { Module } from '@nestjs/common';
import { ServicesModule } from '@/modules/services/services.module';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { BookingsService } from './bookings.service';

@Module({
  imports: [ServicesModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository],
  // repository exported for the reviews module (review-target/ownership lookups)
  exports: [BookingsRepository],
})
export class BookingsModule {}
