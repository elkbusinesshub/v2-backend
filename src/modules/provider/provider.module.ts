import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { ProviderController } from './provider.controller';
import { ProviderRepository } from './provider.repository';
import { ProviderService } from './provider.service';

@Module({
  imports: [UsersModule],
  controllers: [ProviderController],
  providers: [ProviderService, ProviderRepository],
})
export class ProviderModule {}
