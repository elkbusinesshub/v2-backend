import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { ServicesController } from './services.controller';
import { ServicesRepository } from './services.repository';
import { ServicesService } from './services.service';

@Module({
  imports: [LocationsModule],
  controllers: [ServicesController],
  providers: [ServicesService, ServicesRepository],
  // repository exported for the home feed's best-sellers rail
  exports: [ServicesRepository],
})
export class ServicesModule {}
