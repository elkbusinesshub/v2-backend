import { Module } from '@nestjs/common';
import { MarketplaceModule } from '@/modules/marketplace/marketplace.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  // for AdOrdersService — the tracking screen's cancel enforces the same
  // transition rules as the marketplace endpoint rather than its own
  imports: [MarketplaceModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
