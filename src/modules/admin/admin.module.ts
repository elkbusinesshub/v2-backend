import { Module } from '@nestjs/common';
import { HomeServicesModule } from '@/modules/home-services/home-services.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PlacesModule } from '@/modules/places/places.module';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';

/** The admin panel's API. Its own folder, served by the same app as the mobile API. */
@Module({
  imports: [HomeServicesModule, NotificationsModule, PlacesModule],
  controllers: [AdminController],
  providers: [AdminRepository, AdminCatalogService, AdminBookingsService],
  exports: [AdminBookingsService],
})
export class AdminModule {}
