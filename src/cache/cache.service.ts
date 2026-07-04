import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * JSON cache on Redis. Keys are namespaced with `cache:` so cached data can
 * be inspected/flushed independently of auth and rate-limit keys.
 *
 * Failure policy: a broken cache must degrade performance, not availability —
 * read errors log and return null (callers fall through to the source of
 * truth); write errors log and continue.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private namespaced(key: string): string {
    return `cache:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.namespaced(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (err) {
      this.logger.warn(`cache get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(this.namespaced(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`cache set failed for ${key}: ${(err as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys.map((k) => this.namespaced(k)));
    } catch (err) {
      this.logger.warn(`cache del failed: ${(err as Error).message}`);
    }
  }

  /** Read-through helper: `cache.wrap('home:feed', 60, () => repo.load())` */
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
