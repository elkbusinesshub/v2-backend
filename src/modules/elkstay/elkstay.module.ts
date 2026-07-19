import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { ElkStayController } from './elkstay.controller';
import { ElkStayService } from './elkstay.service';
import { StayBookingsRepository } from './stay-bookings.repository';
import { StaysRepository } from './stays.repository';

@Module({
  imports: [UsersModule],
  controllers: [ElkStayController],
  providers: [ElkStayService, StaysRepository, StayBookingsRepository],
})
export class ElkStayModule {}
