import { ValidationPipe, ValidationError } from '@nestjs/common';
import { ErrorDetail, ValidationFailedException } from '../errors/domain.exceptions';

function flatten(errors: ValidationError[], parentPath = ''): ErrorDetail[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own: ErrorDetail[] = Object.values(error.constraints ?? {}).map((message) => ({
      field: path,
      message,
    }));
    const nested = error.children?.length ? flatten(error.children, path) : [];
    return [...own, ...nested];
  });
}

/**
 * Global validation policy:
 *  - whitelist + forbidNonWhitelisted: unknown fields are rejected, which is
 *    both sanitization (mass-assignment protection) and a fast contract check
 *  - transform: DTO classes get real instances (defaults, @Type coercion)
 *  - errors surface through the standard envelope via ValidationFailedException
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => new ValidationFailedException(flatten(errors)),
  });
}
