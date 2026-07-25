import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { UsersModule } from '@/modules/users/users.module';
import { CleanBookingsRepository } from './clean-bookings.repository';
import { CleanCatalogRepository } from './clean-catalog.repository';
import { ElkCleanController } from './elkclean.controller';
import { ElkCleanService } from './elkclean.service';

@Module({
  imports: [UsersModule, LocationsModule],
  controllers: [ElkCleanController],
  providers: [ElkCleanService, CleanCatalogRepository, CleanBookingsRepository],
})
export class ElkCleanModule {}
