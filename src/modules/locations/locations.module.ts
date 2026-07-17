import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService, LocationsRepository],
  // repository exported for modules that need the user's saved addresses
  // (e.g. services booking-options prefills the default address)
  exports: [LocationsRepository],
})
export class LocationsModule {}
