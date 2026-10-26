import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { StorageModule } from '@/storage/storage.module';
import { AdOrdersRepository } from './ad-orders.repository';
import { AdOrdersService } from './ad-orders.service';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceRepository } from './marketplace.repository';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MarketplaceRepository, AdOrdersService, AdOrdersRepository],
  // MarketplaceService so the home feed can embed the same ranked list;
  // AdOrdersService so the orders module's cancel shares its transition rules
  exports: [MarketplaceService, AdOrdersService],
})
export class MarketplaceModule {}
