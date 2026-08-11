import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamServiceException } from '@/common/errors/domain.exceptions';
import type { AppConfig } from '@/config/configuration';

const GATEWAY_URL = 'https://fastsms.sangamamonline.in/api/sms/v1.0/send-sms';
/** Fixed salt the gateway expects in the first hash stage. */
const SIGNATURE_SALT = 'sms@rits-v1.0';
const SIGNATURE_TTL_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 10_000;

const md5 = (input: string): string => createHash('md5').update(input).digest('hex');

/**
 * Sangamam Online FastSMS gateway, ported from the legacy Express backend
 * (`backend-elk` — modules/user/v1/controller/user.controller.js).
 *
 * Auth is a three-stage MD5 chain rather than a static header: the signature
 * covers an expiry timestamp, so each request is only valid for a two-minute
 * window and cannot be replayed later.
 *
 * When `SMS_ENABLED` is false the gateway is never contacted — callers still
 * get a clean return, which keeps local development working without an
 * account. Failures are surfaced, never swallowed: the legacy version
 * returned success even when delivery failed, so users waited for a code
 * that was never sent.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly enabled: boolean;
  private readonly accessToken: string;
  private readonly accessTokenKey: string;
  private readonly senderId: string;
  private readonly countryCode: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.enabled = config.get('sms.enabled', { infer: true });
    this.accessToken = config.get('sms.accessToken', { infer: true });
    this.accessTokenKey = config.get('sms.accessTokenKey', { infer: true });
    this.senderId = config.get('sms.senderId', { infer: true });
    this.countryCode = config.get('sms.countryCode', { infer: true });
  }

  /** True when a real gateway call will be attempted — callers use this to decide whether to log the code. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sends [message] to [phone] (E.164, e.g. +919876543210).
   * Throws {@link UpstreamServiceException} if the gateway rejects, errors, or times out.
   */
  async send(phone: string, message: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`SMS disabled — not sending to ${phone}`);
      return;
    }

    const url = this.buildUrl(this.toLocalNumber(phone), message);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      // Network failure or timeout — the gateway was never reached.
      this.logger.error({ err, phone }, 'SMS gateway request failed');
      throw new UpstreamServiceException('Could not send the SMS — please try again');
    }

    // The gateway's success payload is undocumented here, so the HTTP status is
    // the only signal we trust; the body is logged to make failures diagnosable.
    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      this.logger.error(
        { status: response.status, body, phone },
        'SMS gateway rejected the request',
      );
      throw new UpstreamServiceException('Could not send the SMS — please try again');
    }
  }

  /**
   * The gateway takes the subscriber number without its country code, which
   * travels as a separate parameter.
   */
  private toLocalNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    const cc = this.countryCode.replace(/\D/g, '');
    return cc.length > 0 && digits.startsWith(cc) ? digits.slice(cc.length) : digits;
  }

  private buildUrl(recipient: string, message: string): string {
    const expire = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS;
    const timeKey = md5(`send-sms${SIGNATURE_SALT}${expire}`);
    const timeAccessTokenKey = md5(this.accessToken + timeKey);
    const authSignature = md5(timeAccessTokenKey + this.accessTokenKey);

    // Built by hand rather than with URLSearchParams: the gateway is known to
    // accept this exact encoding (notably a literal '+' in countryCode, which
    // URLSearchParams would percent-encode).
    return (
      `${GATEWAY_URL}?accessToken=${this.accessToken}` +
      `&expire=${expire}` +
      `&authSignature=${authSignature}` +
      `&route=transactional` +
      `&smsHeader=${this.senderId}` +
      `&messageContent=${encodeURIComponent(message)}` +
      `&recipients=${recipient}` +
      `&contentType=text` +
      `&removeDuplicateNumbers=1` +
      `&countryCode=${this.countryCode}`
    );
  }
}
