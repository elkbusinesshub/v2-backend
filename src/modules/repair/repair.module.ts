import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { UsersModule } from '@/modules/users/users.module';
import { RepairBookingsRepository } from './repair-bookings.repository';
import { RepairCatalogRepository } from './repair-catalog.repository';
import { ElkRepController } from './repair.controller';
import { ElkRepService } from './repair.service';

@Module({
  imports: [UsersModule, LocationsModule],
  controllers: [ElkRepController],
  providers: [ElkRepService, RepairCatalogRepository, RepairBookingsRepository],
})
export class ElkRepModule {}
