import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/cache/redis.constants';
import type { AppConfig } from '@/config/configuration';
import {
  TooManyRequestsException,
  UnauthenticatedException,
} from '@/common/errors/domain.exceptions';

const CODE_LENGTH = 4;
const MAX_ATTEMPTS = 5;

/**
 * One-time passcodes for phone login, stored only in Redis (never in the
 * relational DB). Brute force is bounded by a per-code attempt cap, not by
 * hashing — a 4-digit code has just 10,000 possibilities, so the cap and TTL
 * are the actual defense.
 *
 * No SMS provider is wired yet: `issue` logs the code so the login flow is
 * testable end-to-end. Swap the logger call for a real provider (Twilio,
 * MSG91, SNS, ...) when one is chosen.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = config.get('otp.ttlSeconds', { infer: true });
    this.resendCooldownSeconds = config.get('otp.resendCooldownSeconds', { infer: true });
  }

  /** Generates and stores a fresh code for [phone]. Returns the resend cooldown in seconds. */
  async issue(phone: string): Promise<number> {
    const cooldownKey = this.cooldownKey(phone);
    const ttl = await this.redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw new TooManyRequestsException(`Please wait ${ttl}s before requesting another code`);
    }

    const code = randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, '0');
    await Promise.all([
      this.redis.set(this.codeKey(phone), code, 'EX', this.ttlSeconds),
      this.redis.set(cooldownKey, '1', 'EX', this.resendCooldownSeconds),
      this.redis.del(this.attemptsKey(phone)),
    ]);

    this.logger.log(`OTP for ${phone}: ${code}`);
    return this.resendCooldownSeconds;
  }

  /** Verifies [code] for [phone]; throws on mismatch, expiry, or attempt exhaustion. */
  async verify(phone: string, code: string): Promise<void> {
    const key = this.codeKey(phone);
    const stored = await this.redis.get(key);
    if (!stored) {
      throw new UnauthenticatedException('OTP expired or not requested');
    }

    if (stored !== code) {
      const attempts = await this.redis.incr(this.attemptsKey(phone));
      if (attempts >= MAX_ATTEMPTS) {
        await this.redis.del(key, this.attemptsKey(phone));
        throw new UnauthenticatedException('Too many incorrect attempts — request a new code');
      }
      throw new UnauthenticatedException('Invalid OTP');
    }

    await this.redis.del(key, this.attemptsKey(phone));
  }

  private codeKey(phone: string): string {
    return `auth:otp:${phone}`;
  }

  private cooldownKey(phone: string): string {
    return `auth:otp:cooldown:${phone}`;
  }

  private attemptsKey(phone: string): string {
    return `auth:otp:attempts:${phone}`;
  }
}
