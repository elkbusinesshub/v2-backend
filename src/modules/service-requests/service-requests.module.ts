import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PartnerSetupController } from './partner-setup.controller';
import { PartnerSetupRepository } from './partner-setup.repository';
import { PartnerSetupService } from './partner-setup.service';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsRepository } from './service-requests.repository';
import { ServiceRequestsService } from './service-requests.service';

/** Cleaning and vehicle-rental requests, and the partner setup behind them. */
@Module({
  imports: [NotificationsModule],
  controllers: [ServiceRequestsController, PartnerSetupController],
  providers: [
    ServiceRequestsService,
    ServiceRequestsRepository,
    PartnerSetupService,
    PartnerSetupRepository,
  ],
})
export class ServiceRequestsModule {}
