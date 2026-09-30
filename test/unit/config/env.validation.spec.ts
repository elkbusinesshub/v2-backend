import { envSchema } from '@/config/env.validation';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://elk:pw@db.example.com:3306/elk',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'a-production-secret-that-is-long-enough-1234',
};

describe('test OTP phones in production', () => {
  it('are refused unless explicitly allowed', () => {
    const result = envSchema.safeParse({ ...production, OTP_TEST_PHONES: '+919999999999' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain('OTP_TEST_PHONES');
  });

  it('are accepted with OTP_TEST_ALLOW_IN_PRODUCTION=true', () => {
    const result = envSchema.safeParse({
      ...production,
      OTP_TEST_PHONES: '+919999999999',
      OTP_TEST_ALLOW_IN_PRODUCTION: 'true',
    });
    expect(result.success).toBe(true);
  });
});
