import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Interactive docs at /docs (spec at /docs-json). Enabled outside production
 * only — the OpenAPI spec is generated from the same decorators/DTOs that
 * validate requests, so the docs cannot drift from reality.
 */
export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('ELK Business Hub API')
    .setDescription(
      'REST API. All responses use the `{ success, message, data, meta? }` envelope; ' +
        'errors use `{ success: false, message, error, details? }`.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
