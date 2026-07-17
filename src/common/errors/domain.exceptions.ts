import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorDetail {
  field?: string;
  message: string;
}

/**
 * Base class for all business/domain errors. Carries a machine-readable
 * `code` (stable contract for the mobile app) alongside the human message.
 * Throw these from services — never craft HTTP responses in services.
 */
export class DomainException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message, status);
  }
}

export class ValidationFailedException extends DomainException {
  constructor(details: ErrorDetail[]) {
    super(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', details);
  }
}

export class UnauthenticatedException extends DomainException {
  constructor(message = 'Authentication required') {
    super(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenResourceException extends DomainException {
  constructor(message = 'You do not have permission to perform this action') {
    super(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }
}

export class ResourceNotFoundException extends DomainException {
  constructor(resource = 'Resource') {
    super(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${resource} not found`);
  }
}

export class DuplicateResourceException extends DomainException {
  constructor(message = 'Resource already exists') {
    super(HttpStatus.CONFLICT, 'CONFLICT', message);
  }
}

export class TooManyRequestsException extends DomainException {
  constructor(message = 'Too many requests') {
    super(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS', message);
  }
}
