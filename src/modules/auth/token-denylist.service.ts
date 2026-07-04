import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/cache/redis.constants';

/**
 * Redis denylist for access tokens (by jti). Lets logout/compromise take
 * effect immediately instead of waiting out the 15-minute token TTL.
 * Entries expire together with the token, so the set stays tiny.
 *
 * Fail-closed by design: if Redis is down, isRevoked throws and the request
 * fails — availability is never traded for accepting a possibly-revoked token.
 */
@Injectable()
export class TokenDenylistService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(jti: string): string {
    return `auth:denylist:${jti}`;
  }

  async revoke(jti: string, tokenExpEpochSeconds: number): Promise<void> {
    const ttl = tokenExpEpochSeconds - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.set(this.key(jti), '1', 'EX', ttl);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(jti))) === 1;
  }
}
