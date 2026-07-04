import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config/configuration';
import { PRISMA } from './prisma.constants';
import { createPrismaClient, ExtendedPrismaClient } from './prisma.extension';

/**
 * Connects eagerly at boot (fail fast on a bad DATABASE_URL) and disconnects
 * on graceful shutdown.
 */
@Injectable()
class PrismaLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createPrismaClient({ logQueries: !config.get('app.isProduction', { infer: true }) }),
    },
    PrismaLifecycle,
  ],
  exports: [PRISMA],
})
export class PrismaModule {}
