import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PorterCatalogRepository } from '@/modules/porter/porter-catalog.repository';
import { RideTypesRepository } from '@/modules/rides/ride-types.repository';
import { DispatchController } from './dispatch.controller';
import { DispatchGateway } from './dispatch.gateway';
import { DispatchRepository } from './dispatch.repository';
import { DISPATCH_QUEUE, DispatchProcessor, DispatchScheduler } from './dispatch.queue';
import { DispatchService } from './dispatch.service';

/**
 * Shared dispatch for the two products that send somebody to you.
 *
 * The catalogue repositories are provided directly rather than by importing
 * their modules: both would import this one back for the offer loop, and the
 * repositories carry no state of their own.
 */
@Module({
  imports: [BullModule.registerQueue({ name: DISPATCH_QUEUE })],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    DispatchRepository,
    DispatchGateway,
    RideTypesRepository,
    PorterCatalogRepository,
    DispatchScheduler,
    DispatchProcessor,
  ],
  exports: [DispatchService, DispatchGateway, DispatchScheduler],
})
export class DispatchModule {}
