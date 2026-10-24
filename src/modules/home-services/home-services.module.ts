import { Module } from '@nestjs/common';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { LocationsModule } from '@/modules/locations/locations.module';
import { RazorpayModule } from '@/modules/razorpay/razorpay.module';
import { UsersModule } from '@/modules/users/users.module';
import { HomeServicesController } from './home-services.controller';
import { HomeServicesRepository } from './home-services.repository';
import { HomeServicesService } from './home-services.service';

@Module({
  imports: [LocationsModule, UsersModule, WalletModule, RazorpayModule],
  controllers: [HomeServicesController],
  providers: [HomeServicesService, HomeServicesRepository],
  // The admin module reads and updates the same rows.
  exports: [HomeServicesRepository],
})
export class HomeServicesModule {}
