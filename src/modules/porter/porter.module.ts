import { Module } from '@nestjs/common';
import { DispatchModule } from '@/modules/dispatch/dispatch.module';
import { LocationsModule } from '@/modules/locations/locations.module';
import { PorterBookingsRepository } from './porter-bookings.repository';
import { PorterCatalogRepository } from './porter-catalog.repository';
import { PorterController } from './porter.controller';
import { PorterService } from './porter.service';

@Module({
  imports: [LocationsModule, DispatchModule],
  controllers: [PorterController],
  providers: [PorterService, PorterCatalogRepository, PorterBookingsRepository],
})
export class PorterModule {}
