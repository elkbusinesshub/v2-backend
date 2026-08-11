import { Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * FCM transport. Kept out of `modules/` because it is infrastructure like
 * storage and cache: several features will fan out through it, none of them
 * own it.
 */
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
