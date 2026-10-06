import { Module } from '@nestjs/common';
import { HomeServicesModule } from '@/modules/home-services/home-services.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PlacesModule } from '@/modules/places/places.module';
import { AdminApprovalsController } from './admin-approvals.controller';
import { AdminApprovalsService } from './admin-approvals.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { ServiceChangeRepository } from './service-change.repository';

/** The admin panel's API. Its own folder, served by the same app as the mobile API. */
@Module({
  imports: [HomeServicesModule, NotificationsModule, PlacesModule],
  controllers: [AdminController, AdminApprovalsController, AdminUsersController],
  providers: [
    AdminRepository,
    ServiceChangeRepository,
    AdminUsersRepository,
    AdminCatalogService,
    AdminBookingsService,
    AdminApprovalsService,
    AdminUsersService,
  ],
  exports: [AdminBookingsService],
})
export class AdminModule {}
