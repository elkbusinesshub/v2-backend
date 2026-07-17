import { Module } from '@nestjs/common';
import { LocationsModule } from '@/modules/locations/locations.module';
import { ServicesModule } from '@/modules/services/services.module';
import { UsersModule } from '@/modules/users/users.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

/** Aggregation only — composes users/locations/services, owns no tables. */
@Module({
  imports: [UsersModule, LocationsModule, ServicesModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
