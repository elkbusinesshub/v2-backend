/**
 * Controllers may return either raw data (wrapped automatically with
 * message "OK") or an ApiResponse when they want a custom message/meta.
 * The EnvelopeInterceptor produces the final wire format:
 *
 *   { success: true, message, data, meta? }
 */
export class ApiResponse<T> {
  constructor(
    readonly data: T,
    readonly message = 'OK',
    readonly meta?: Record<string, unknown>,
  ) {}

  static of<T>(data: T, message?: string, meta?: Record<string, unknown>): ApiResponse<T> {
    return new ApiResponse(data, message, meta);
  }
}
