/** Injection token for the shared ioredis client (cache, denylist, rate limits). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
