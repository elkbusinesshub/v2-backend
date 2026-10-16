import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { WalletController } from './wallet.controller';
import { WalletRepository } from './wallet.repository';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController, PaymentsController],
  providers: [WalletService, WalletRepository],
  exports: [WalletService],
})
export class WalletModule {}
