import { Module } from '@nestjs/common';
import { PorterBookingsRepository } from './porter-bookings.repository';
import { PorterCatalogRepository } from './porter-catalog.repository';
import { PorterController } from './porter.controller';
import { PorterService } from './porter.service';

@Module({
  controllers: [PorterController],
  providers: [PorterService, PorterCatalogRepository, PorterBookingsRepository],
})
export class PorterModule {}
