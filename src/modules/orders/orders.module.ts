import { Module } from '@nestjs/common';
import { MarketplaceModule } from '@/modules/marketplace/marketplace.module';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  // for AdOrdersService — the tracking screen's cancel enforces the same
  // transition rules as the marketplace endpoint rather than its own
  imports: [MarketplaceModule],
  controllers: [OrdersController],
  providers: [OrdersService, ChatRepository, ChatGateway],
})
export class OrdersModule {}
