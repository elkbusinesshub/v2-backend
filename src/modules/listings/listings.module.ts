import { Module } from '@nestjs/common';
import { MarketplaceModule } from '@/modules/marketplace/marketplace.module';
import { ListingsController } from './listings.controller';
import { ListingsRepository } from './listings.repository';
import { ListingsService } from './listings.service';

@Module({
  imports: [MarketplaceModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsRepository],
})
export class ListingsModule {}
