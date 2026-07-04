import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException, ErrorDetail } from '../errors/domain.exceptions';

interface ErrorEnvelope {
  success: false;
  message: string;
  error: string;
  details?: ErrorDetail[];
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'TOO_MANY_REQUESTS',
};

/** Duck-typed check so non-repository code never imports Prisma classes. */
function isPrismaKnownError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    e.constructor?.name === 'PrismaClientKnownRequestError' &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/**
 * The single place HTTP error responses are produced. Everything —
 * domain exceptions, validation failures, framework HttpExceptions,
 * database errors, and unknown crashes — is normalized to:
 *
 *   { success: false, message, error: CODE, details? }
 *
 * Unknown errors are logged with full stack but returned opaque: internals
 * must never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // WS/RPC contexts handle their own errors
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.normalize(exception);

    const logContext = {
      method: request.method,
      url: request.originalUrl,
      status,
      code: body.error,
    };
    if (status >= 500) {
      this.logger.error(
        { ...logContext, err: exception instanceof Error ? exception.stack : exception },
        body.message,
      );
    } else {
      this.logger.warn(logContext, body.message);
    }

    response.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof DomainException) {
      return {
        status: exception.getStatus(),
        body: {
          success: false,
          message: exception.message,
          error: exception.code,
          ...(exception.details ? { details: exception.details } : {}),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      // class-validator / framework shapes: string | { message: string | string[] }
      let message = exception.message;
      let details: ErrorDetail[] | undefined;
      if (typeof res === 'object' && res !== null && 'message' in res) {
        const m = (res as { message: string | string[] }).message;
        if (Array.isArray(m)) {
          message = 'Validation failed';
          details = m.map((msg) => ({ message: msg }));
        } else if (typeof m === 'string') {
          message = m;
        }
      }
      return {
        status,
        body: {
          success: false,
          message,
          error: CODE_BY_STATUS[status] ?? 'ERROR',
          ...(details ? { details } : {}),
        },
      };
    }

    if (isPrismaKnownError(exception)) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: { success: false, message: 'Resource already exists', error: 'CONFLICT' },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { success: false, message: 'Resource not found', error: 'NOT_FOUND' },
        };
      }
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { success: false, message: 'Database error', error: 'DATABASE_ERROR' },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { success: false, message: 'Internal server error', error: 'INTERNAL' },
    };
  }
}
