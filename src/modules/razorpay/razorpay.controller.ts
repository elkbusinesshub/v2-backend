import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { SkipEnvelope } from '@/common/decorators/skip-envelope.decorator';
import { RazorpayService } from './razorpay.service';

/**
 * Razorpay's server-to-server notifications. No access token: the request is
 * authenticated by its HMAC signature instead, checked over the raw body
 * (main.ts keeps it), since re-serialised JSON would not match.
 */
@Controller('payments/razorpay')
export class RazorpayController {
  constructor(private readonly razorpay: RazorpayService) {}

  @Post('webhook')
  @Public()
  @SkipEnvelope()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ): Promise<{ ok: true }> {
    await this.razorpay.handleWebhook(req.rawBody, signature);
    return { ok: true };
  }
}
