import { Module } from '@nestjs/common';
import { AdminModule } from '@/modules/admin/admin.module';
import { HomeServicesModule } from '@/modules/home-services/home-services.module';
import { ProController } from './pro.controller';
import { ProRepository } from './pro.repository';
import { ProService } from './pro.service';

/** The professional's own screens: their jobs and their duty status. */
@Module({
  imports: [AdminModule, HomeServicesModule],
  controllers: [ProController],
  providers: [ProRepository, ProService],
})
export class ProModule {}
