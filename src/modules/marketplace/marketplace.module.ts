import { Module } from '@nestjs/common';
import { StorageModule } from '@/storage/storage.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceRepository } from './marketplace.repository';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [StorageModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MarketplaceRepository],
  // exported so the home feed can embed the same ranked list
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
