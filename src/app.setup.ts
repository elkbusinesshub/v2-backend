import compression from 'compression';
import helmet from 'helmet';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildValidationPipe } from '@/common/pipes/validation.factory';
import type { AppConfig } from '@/config/configuration';

/**
 * Everything the HTTP pipeline needs, shared verbatim between main.ts and
 * integration tests — so tests exercise the exact production pipeline.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);

  // Behind ALB/nginx: derive client IP from X-Forwarded-For (rate limiting,
  // session metadata) — trust exactly one proxy hop.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(compression());

  // Payload DoS guard — raise per-route later if a real use case appears
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.enableCors({
    origin: config.get('app.corsOrigins', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 3600,
  });

  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(buildValidationPipe());
}
