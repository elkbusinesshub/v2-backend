import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappStatus } from '@prisma/client';
import type { AppConfig } from '@/config/configuration';

const REQUEST_TIMEOUT_MS = 10_000;

export interface WhatsappResult {
  status: WhatsappStatus;
  /** WhatsApp's message id (wamid…) when it was accepted. */
  messageId: string | null;
  error: string | null;
}

/**
 * WhatsApp Cloud API (Meta). Sends approved message templates — the only kind
 * a business may send to someone who has not messaged it in the last 24 hours.
 *
 * Never throws: a job is assigned whether or not the message goes, and the
 * caller records the result so the admin can see it and resend. When
 * `WHATSAPP_ENABLED` is false nothing is sent and the message is only logged.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly cfg: AppConfig['whatsapp'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('whatsapp', { infer: true });
  }

  get templateName(): string {
    return this.cfg.templateName;
  }

  /**
   * Sends the configured template to [phone] (E.164, e.g. +919876543210) with
   * [params] as its body variables {{1}}, {{2}}, … in order.
   */
  async sendTemplate(phone: string, params: string[]): Promise<WhatsappResult> {
    const to = phone.replace(/\D/g, '');
    if (!this.cfg.enabled) {
      this.logger.warn(
        `WhatsApp disabled — not sending ${this.cfg.templateName} to ${phone}: ${params.join(' | ')}`,
      );
      return { status: WhatsappStatus.SKIPPED, messageId: null, error: null };
    }

    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: this.cfg.templateName,
        language: { code: this.cfg.templateLanguage },
        components: [
          {
            type: 'body',
            parameters: params.map((text) => ({ type: 'text', text: templateText(text) })),
          },
        ],
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      };
      if (!res.ok || json.error) {
        const error =
          `${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? 'request failed'}`.trim();
        this.logger.warn(`WhatsApp refused ${this.cfg.templateName} to ${phone}: ${error}`);
        return { status: WhatsappStatus.FAILED, messageId: null, error };
      }
      return {
        status: WhatsappStatus.SENT,
        messageId: json.messages?.[0]?.id ?? null,
        error: null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`WhatsApp unreachable for ${phone}: ${error}`);
      return { status: WhatsappStatus.FAILED, messageId: null, error };
    }
  }
}

/**
 * WhatsApp rejects template variables that are empty, contain new lines or
 * tabs, or have more than four spaces in a row.
 */
export function templateText(text: string): string {
  const clean = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return clean.length > 0 ? clean : '-';
}
