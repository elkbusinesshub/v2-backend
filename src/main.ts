import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { setupSwagger } from '@/common/openapi/setup-swagger';
import type { AppConfig } from '@/config/configuration';
import { RedisIoAdapter } from '@/sockets/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true, // hold logs until pino takes over
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.flushLogs();

  const config = app.get(ConfigService<AppConfig, true>);
  configureApp(app);

  // Socket.IO with Redis pub/sub fan-out across instances
  const ioAdapter = new RedisIoAdapter(app, config.get('app.corsOrigins', { infer: true }));
  await ioAdapter.connectToRedis(config.get('redis.url', { infer: true }));
  app.useWebSocketAdapter(ioAdapter);

  if (config.get('swagger.enabled', { infer: true })) {
    setupSwagger(app);
  }

  // SIGTERM/SIGINT → stop accepting traffic, drain connections, run
  // OnApplicationShutdown hooks (Prisma disconnect, Redis quit), exit.
  app.enableShutdownHooks();

  const port = config.get('app.port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port} (${config.get('app.nodeEnv', { infer: true })})`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- logger may not exist yet
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
