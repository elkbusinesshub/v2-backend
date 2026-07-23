import { Module } from '@nestjs/common';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [BookingsModule],
  controllers: [OrdersController],
  providers: [OrdersService, ChatRepository, ChatGateway],
})
export class OrdersModule {}
