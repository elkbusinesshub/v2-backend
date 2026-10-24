import { Module } from '@nestjs/common';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { HomeServicesModule } from '@/modules/home-services/home-services.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PlacesModule } from '@/modules/places/places.module';
import { RazorpayModule } from '@/modules/razorpay/razorpay.module';
import { WhatsappModule } from '@/modules/whatsapp/whatsapp.module';
import { AdminApprovalsController } from './admin-approvals.controller';
import { AdminApprovalsService } from './admin-approvals.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { ProfessionalApprovalsController } from './professional-approvals.controller';
import { ProfessionalApprovalsRepository } from './professional-approvals.repository';
import { ProfessionalApprovalsService } from './professional-approvals.service';
import { ServiceChangeRepository } from './service-change.repository';

/** The admin panel's API. Its own folder, served by the same app as the mobile API. */
@Module({
  imports: [
    HomeServicesModule,
    NotificationsModule,
    PlacesModule,
    WhatsappModule,
    WalletModule,
    RazorpayModule,
  ],
  controllers: [
    AdminController,
    AdminApprovalsController,
    ProfessionalApprovalsController,
    AdminUsersController,
  ],
  providers: [
    AdminRepository,
    ServiceChangeRepository,
    AdminUsersRepository,
    AdminCatalogService,
    AdminBookingsService,
    AdminApprovalsService,
    AdminUsersService,
    ProfessionalApprovalsRepository,
    ProfessionalApprovalsService,
  ],
})
export class AdminModule {}
