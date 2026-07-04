import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '@/config/configuration';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * One shared connection for request-scoped commands (cache, token denylist,
 * rate limiting). Socket.IO's adapter and BullMQ maintain their own
 * connections — a subscribed connection cannot execute normal commands.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new Redis(config.get('redis.url', { infer: true }), {
          // fail fast at boot instead of buffering commands forever
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
        }),
    },
    RedisLifecycle,
    CacheService,
  ],
  exports: [REDIS_CLIENT, CacheService],
})
export class RedisModule {}
