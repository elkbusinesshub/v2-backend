import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { ApiResponse } from '../http/api-response';

interface Envelope {
  success: true;
  message: string;
  data: unknown;
  meta?: Record<string, unknown>;
}

/** Wraps every successful response in the standard envelope. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((value: unknown): Envelope => {
        if (value instanceof ApiResponse) {
          return {
            success: true,
            message: value.message,
            data: value.data,
            ...(value.meta ? { meta: value.meta } : {}),
          };
        }
        return { success: true, message: 'OK', data: value ?? null };
      }),
    );
  }
}
