import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { AppConfig } from '@/config/configuration';

/**
 * BullMQ foundation. No queues are registered yet — a future module adds:
 *
 *   imports: [BullModule.registerQueue({ name: 'notifications' })]
 *
 * then injects `@InjectQueue('notifications')` to enqueue, and declares a
 * `@Processor('notifications')` worker class. Job keys are prefixed with
 * `jobs:` to keep Redis tidy alongside cache/auth/rate-limit keys.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          url: config.get('redis.url', { infer: true }),
          // BullMQ workers use blocking commands; retries must not be capped
          maxRetriesPerRequest: null,
        },
        prefix: 'jobs',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
  ],
})
export class JobsModule {}
