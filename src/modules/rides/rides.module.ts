import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { RideBookingsRepository } from './ride-bookings.repository';
import { RideTypesRepository } from './ride-types.repository';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [LocationsModule],
  controllers: [RidesController],
  providers: [RidesService, RideTypesRepository, RideBookingsRepository],
})
export class RidesModule {}
