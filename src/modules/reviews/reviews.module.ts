import { Module } from '@nestjs/common';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { ServicesModule } from '@/modules/services/services.module';
import { UsersModule } from '@/modules/users/users.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [BookingsModule, ServicesModule, UsersModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsRepository],
})
export class ReviewsModule {}
