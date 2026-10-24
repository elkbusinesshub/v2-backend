import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamServiceException } from '@/common/errors/domain.exceptions';
import type { AppConfig } from '@/config/configuration';

const API_URL = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;

/** Rupees → paise, the only unit Razorpay takes. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** A payment as Razorpay reports it. Amounts are paise. */
export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method: string;
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

/**
 * Thin transport over the four Razorpay calls ELK makes, plus the two
 * signature checks. HTTP and error translation only; what to do with a payment
 * is {@link RazorpayService}'s decision.
 *
 * Plain fetch rather than the `razorpay` package: four endpoints do not earn a
 * dependency, and this keeps the paise conversion and timeouts in one place.
 */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger(RazorpayClient.name);
  readonly enabled: boolean;
  readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.enabled = config.get('razorpay.enabled', { infer: true });
    this.keyId = config.get('razorpay.keyId', { infer: true });
    this.keySecret = config.get('razorpay.keySecret', { infer: true });
    this.webhookSecret = config.get('razorpay.webhookSecret', { infer: true });
  }

  /** A new order for [paise]. [receipt] is ours (the booking code), shown in the dashboard. */
  async createOrder(paise: number, receipt: string, notes: Record<string, string>) {
    return this.call<{ id: string }>('POST', '/orders', 'create order', {
      amount: paise,
      currency: 'INR',
      receipt,
      notes,
    });
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.call('GET', `/payments/${encodeURIComponent(paymentId)}`, 'fetch payment');
  }

  /** Captures an authorized payment, for accounts not set to capture automatically. */
  async capture(paymentId: string, paise: number): Promise<RazorpayPayment> {
    return this.call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, 'capture', {
      amount: paise,
      currency: 'INR',
    });
  }

  async refund(paymentId: string, paise: number, notes: Record<string, string>) {
    return this.call<RazorpayRefund>(
      'POST',
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      'refund',
      { amount: paise, notes },
    );
  }

  /** The checkout's proof of payment: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
  isValidPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    return matches(hmac(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  /** A webhook's X-Razorpay-Signature: HMAC-SHA256 of the raw body with the webhook secret. */
  isValidWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return matches(hmac(this.webhookSecret, rawBody), signature);
  }

  private async call<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error({ err, path }, `razorpay ${what} did not respond`);
      throw new UpstreamServiceException('Payments are unavailable right now. Please try again.');
    }
    const json = (await response.json().catch(() => null)) as T | null;
    if (!response.ok || json === null) {
      this.logger.error({ status: response.status, body: json, path }, `razorpay ${what} failed`);
      throw new UpstreamServiceException('Payments are unavailable right now. Please try again.');
    }
    return json;
  }
}

function hmac(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time, so a forged signature cannot be found by timing the comparison. */
function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
