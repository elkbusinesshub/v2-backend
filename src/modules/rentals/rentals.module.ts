import { Module } from '@nestjs/common';
import { RentalBookingsRepository } from './rental-bookings.repository';
import { RentalCarsRepository } from './rental-cars.repository';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';

@Module({
  controllers: [RentalsController],
  providers: [RentalsService, RentalCarsRepository, RentalBookingsRepository],
})
export class RentalsModule {}
