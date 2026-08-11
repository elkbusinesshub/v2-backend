import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, deleteApp, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { AppConfig } from '@/config/configuration';

/** FCM caps a multicast at 500 tokens per call. */
const MULTICAST_BATCH_SIZE = 500;

/**
 * Error codes that mean the token is dead, not that the send failed. Anything
 * else (quota, transient unavailability) must not cost the user their token.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export interface PushMessage {
  title: string;
  body: string;
  /** FCM requires every data value to be a string. */
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens FCM rejected as dead — callers delete these. */
  deadTokens: string[];
}

/**
 * Firebase Cloud Messaging, ported from the legacy backend
 * (`backend-elk/helpers/firebase.js`), which used the same
 * `elkbusinesshub` Firebase project.
 *
 * Two deliberate differences from the legacy version:
 *  * it never throws at the caller — a failed push must not fail the action
 *    that triggered it (the notification is already stored and will show in
 *    the app's list either way);
 *  * dead tokens are *reported* rather than deleted here, so the service stays
 *    free of database concerns and the caller owns its own storage.
 */
@Injectable()
export class PushService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PushService.name);
  private readonly configuredEnabled: boolean;
  private readonly serviceAccountPath: string;
  private app: App | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.configuredEnabled = config.get('push.enabled', { infer: true });
    this.serviceAccountPath = config.get('push.serviceAccountPath', { infer: true });
  }

  /**
   * Credentials are loaded once at boot so a broken service-account file is a
   * startup warning rather than a surprise on the first notification.
   */
  onModuleInit(): void {
    if (!this.configuredEnabled) {
      this.logger.warn('push disabled — notifications will be stored but not delivered');
      return;
    }
    try {
      const path = isAbsolute(this.serviceAccountPath)
        ? this.serviceAccountPath
        : resolve(process.cwd(), this.serviceAccountPath);
      // The file is Google's own snake_case JSON; `cert()` takes the camelCase
      // shape, so the three fields it needs are mapped across explicitly.
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        project_id: string;
        client_email: string;
        private_key: string;
      };
      const serviceAccount: ServiceAccount = {
        projectId: raw.project_id,
        clientEmail: raw.client_email,
        privateKey: raw.private_key,
      };

      // A named app, so tests and any other Firebase usage cannot collide with
      // the default instance.
      this.app = initializeApp({ credential: cert(serviceAccount) }, 'elk-push');
      this.logger.log(`push enabled for Firebase project ${raw.project_id}`);
    } catch (err) {
      this.logger.error({ err, path: this.serviceAccountPath }, 'could not initialise FCM');
      this.app = null;
    }
  }

  /** Releases the Firebase connection so the process can exit cleanly. */
  async onApplicationShutdown(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
      this.app = null;
    }
  }

  /** True only when credentials actually loaded — not merely when the flag is on. */
  get isEnabled(): boolean {
    return this.app !== null;
  }

  /**
   * Sends [message] to every token in [tokens].
   *
   * Never throws: the return value reports what happened. Duplicate tokens are
   * collapsed so one device is not notified twice.
   */
  async sendToTokens(tokens: string[], message: PushMessage): Promise<PushResult> {
    const unique = [...new Set(tokens.filter((t) => t.length > 0))];
    if (!this.app || unique.length === 0) {
      return { sent: 0, failed: 0, deadTokens: [] };
    }

    const messaging = getMessaging(this.app);
    const result: PushResult = { sent: 0, failed: 0, deadTokens: [] };

    for (let i = 0; i < unique.length; i += MULTICAST_BATCH_SIZE) {
      const batch = unique.slice(i, i + MULTICAST_BATCH_SIZE);
      await this.sendBatch(messaging, batch, message, result);
    }
    return result;
  }

  private async sendBatch(
    messaging: Messaging,
    tokens: string[],
    message: PushMessage,
    result: PushResult,
  ): Promise<void> {
    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        // High priority so a booking update wakes a dozing device; without it
        // Android may hold the message until the next maintenance window.
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      result.sent += response.successCount;
      result.failed += response.failureCount;

      response.responses.forEach((individual, index) => {
        if (individual.success) return;
        const code = individual.error?.code ?? 'unknown';
        if (DEAD_TOKEN_CODES.has(code)) {
          result.deadTokens.push(tokens[index]!);
        } else {
          this.logger.warn({ code, message: individual.error?.message }, 'FCM send failed');
        }
      });
    } catch (err) {
      // A whole-batch failure (network, auth) — no token is provably dead.
      this.logger.error({ err, count: tokens.length }, 'FCM multicast failed');
      result.failed += tokens.length;
    }
  }
}
