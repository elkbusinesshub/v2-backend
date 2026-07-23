import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { OffersController } from './offers.controller';
import { OffersRepository } from './offers.repository';
import { OffersService } from './offers.service';

@Module({
  imports: [UsersModule],
  controllers: [OffersController],
  providers: [OffersService, OffersRepository],
})
export class OffersModule {}
