import { z } from 'zod';

/** 'true'/'false' string → boolean (z.coerce.boolean treats "false" as true — avoid). */
const boolString = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),

    // Comma-separated E.164 phones that always receive OTP_TEST_CODE and are
    // never sent an SMS — ported from the legacy backend's hardcoded
    // 9999999999 → 123456. Refused in production (see superRefine below)
    // unless OTP_TEST_ALLOW_IN_PRODUCTION=true, for a testing team before
    // launch. Anyone who knows a test phone and the code can sign in as it.
    OTP_TEST_PHONES: z.string().default(''),
    OTP_TEST_ALLOW_IN_PRODUCTION: boolString('false'),
    OTP_TEST_CODE: z
      .string()
      .regex(/^\d{6}$/, 'OTP_TEST_CODE must be exactly 6 digits')
      .default('123456'),

    // Sangamam Online FastSMS gateway. Disabled → the OTP is only logged.
    SMS_ENABLED: boolString('false'),
    SMS_ACCESS_TOKEN: z.string().default(''),
    SMS_ACCESS_TOKEN_KEY: z.string().default(''),
    SMS_SENDER_ID: z.string().default('SGMOLN'),
    SMS_COUNTRY_CODE: z.string().default('+91'),

    // WhatsApp Cloud API (Meta). Disabled → job messages are only logged.
    // The template must be approved in WhatsApp Manager; its body variables
    // are listed in src/modules/whatsapp/job-message.ts.
    WHATSAPP_ENABLED: boolString('false'),
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_TEMPLATE_NAME: z.string().default('elk_job_assigned'),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),

    // Firebase Cloud Messaging. Disabled → notifications are still stored and
    // returned by GET /notifications, they just do not reach the device.
    PUSH_ENABLED: boolString('false'),
    // Path to the service-account JSON. Deployments mount it as a secret file;
    // it must never be committed (see .gitignore).
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('secrets/firebase-service-account.json'),

    // Razorpay checkout for ELK's cleaning and repair bookings. Disabled →
    // those bookings can only be paid from the ELK Wallet. Test keys
    // (rzp_test_...) for development; the webhook secret is the one typed in
    // when creating the webhook in the Razorpay dashboard.
    RAZORPAY_ENABLED: boolString('false'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    // Google Geocoding + Places. Empty key → /places returns 502 rather than
    // silently proxying an unauthenticated request.
    GOOGLE_MAPS_API_KEY: z.string().default(''),
    // ISO 3166-1 alpha-2 biasing for autocomplete. India, per the product's
    // actual market.
    PLACES_REGION_CODE: z.string().length(2).default('IN'),

    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

    S3_REGION: z.string().default('me-central-1'),
    S3_BUCKET: z.string().default('elk-dev'),
    S3_ENDPOINT: z
      .string()
      .url()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    S3_FORCE_PATH_STYLE: boolString('false'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SWAGGER_ENABLED: boolString('true'),
  })
  // Credentials for each integration are only required once that integration
  // is actually switched on, so local development needs no third-party
  // accounts at all.
  .superRefine((env, ctx) => {
    if (env.WHATSAPP_ENABLED) {
      for (const key of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] as const) {
        if (env[key].length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when WHATSAPP_ENABLED=true`,
          });
        }
      }
    }
    if (env.RAZORPAY_ENABLED) {
      for (const key of [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const) {
        if (env[key].length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when RAZORPAY_ENABLED=true`,
          });
        }
      }
    }
    if (env.SMS_ENABLED) {
      for (const key of ['SMS_ACCESS_TOKEN', 'SMS_ACCESS_TOKEN_KEY'] as const) {
        if (env[key].length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when SMS_ENABLED=true`,
          });
        }
      }
    }
    // A fixed-code phone is a permanent unauthenticated login. Refusing to
    // boot is the only reliable way to stop one reaching production by
    // accident; allowing it takes a second, explicit setting.
    if (
      env.NODE_ENV === 'production' &&
      env.OTP_TEST_PHONES.trim().length > 0 &&
      !env.OTP_TEST_ALLOW_IN_PRODUCTION
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_TEST_PHONES'],
        message:
          'OTP_TEST_PHONES must be empty in production — it bypasses OTP verification. ' +
          'Set OTP_TEST_ALLOW_IN_PRODUCTION=true to allow it for testing',
      });
    }
    if (env.PUSH_ENABLED && env.FIREBASE_SERVICE_ACCOUNT_PATH.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_SERVICE_ACCOUNT_PATH'],
        message: 'FIREBASE_SERVICE_ACCOUNT_PATH is required when PUSH_ENABLED=true',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to ConfigModule.forRoot({ validate }) — the process refuses to boot
 * with a missing or malformed environment, printing every problem at once.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
