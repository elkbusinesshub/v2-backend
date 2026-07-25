import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { REDIS_CLIENT } from '@/cache/redis.constants';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '@/common/interceptors/envelope.interceptor';
import { configuration, type AppConfig } from '@/config/configuration';
import { validateEnv } from '@/config/env.validation';
import { RedisModule } from '@/cache/redis.module';
import { PrismaModule } from '@/database/prisma.module';
import { JobsModule } from '@/jobs/jobs.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { AppConfigModule } from '@/modules/config/config.module';
import { ElkCleanModule } from '@/modules/elkclean/elkclean.module';
import { ElkStayModule } from '@/modules/elkstay/elkstay.module';
import { HealthModule } from '@/modules/health/health.module';
import { HomeModule } from '@/modules/home/home.module';
import { LocationsModule } from '@/modules/locations/locations.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { OffersModule } from '@/modules/offers/offers.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { PorterModule } from '@/modules/porter/porter.module';
import { ProviderModule } from '@/modules/provider/provider.module';
import { ElkRepModule } from '@/modules/repair/repair.module';
import { RentalsModule } from '@/modules/rentals/rentals.module';
import { RidesModule } from '@/modules/rides/rides.module';
import { ReviewsModule } from '@/modules/reviews/reviews.module';
import { ServicesModule } from '@/modules/services/services.module';
import { UsersModule } from '@/modules/users/users.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { SocketsModule } from '@/sockets/sockets.module';
import { StorageModule } from '@/storage/storage.module';

@Module({
  imports: [
    // ── configuration: fail fast on a bad environment ────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    // ── structured logging (pino) with request correlation ──────────────
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('log.level', { infer: true }),
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          // secrets never reach the logs
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            remove: true,
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
          },
          ...(config.get('app.isProduction', { infer: true })
            ? {}
            : {
                transport: {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                },
              }),
        },
      }),
    }),

    // ── rate limiting, shared across instances via Redis ────────────────
    // reuses the app Redis connection so lifecycle (quit on shutdown) is
    // owned by RedisModule — a connection created here would leak on SIGTERM
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService<AppConfig, true>, redis: Redis) => ({
        throttlers: [
          {
            ttl: config.get('throttle.ttlSeconds', { infer: true }) * 1000,
            limit: config.get('throttle.limit', { infer: true }),
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),

    // ── infrastructure ───────────────────────────────────────────────────
    PrismaModule,
    RedisModule,
    StorageModule,
    JobsModule,
    SocketsModule,

    // ── features ─────────────────────────────────────────────────────────
    UsersModule,
    AuthModule,
    HealthModule,
    LocationsModule,
    ServicesModule,
    HomeModule,
    BookingsModule,
    ElkStayModule,
    RentalsModule,
    ElkCleanModule,
    PorterModule,
    RidesModule,
    ElkRepModule,
    ReviewsModule,
    NotificationsModule,
    OffersModule,
    AppConfigModule,
    WalletModule,
    OrdersModule,
    ProviderModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
