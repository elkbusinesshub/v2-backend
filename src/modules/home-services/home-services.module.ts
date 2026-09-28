import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { UsersModule } from '@/modules/users/users.module';
import { HomeServicesController } from './home-services.controller';
import { HomeServicesRepository } from './home-services.repository';
import { HomeServicesService } from './home-services.service';

@Module({
  imports: [LocationsModule, UsersModule],
  controllers: [HomeServicesController],
  providers: [HomeServicesService, HomeServicesRepository],
  // The admin module reads and updates the same rows.
  exports: [HomeServicesRepository],
})
export class HomeServicesModule {}
