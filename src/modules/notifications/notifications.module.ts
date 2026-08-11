import { Module } from '@nestjs/common';
import { PushModule } from '@/push/push.module';
import { DeviceTokensRepository } from './device-tokens.repository';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, DeviceTokensRepository],
  // exported so other verticals can raise a notification (and thus a push)
  // without reaching for the repository directly
  exports: [NotificationsService],
})
export class NotificationsModule {}
