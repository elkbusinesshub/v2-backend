import { Global, Module } from '@nestjs/common';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';

/** Which modules each admin may use; available everywhere. */
@Global()
@Module({
  providers: [AdminAccessRepository, AdminAccessService],
  exports: [AdminAccessService],
})
export class AdminAccessModule {}
