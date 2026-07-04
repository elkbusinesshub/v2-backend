import { validateEnv } from './env.validation';

/**
 * The single source of typed configuration. Nothing outside src/config reads
 * process.env. Consumers inject `ConfigService<AppConfig, true>` and use
 * `config.get('jwt.accessSecret', { infer: true })`.
 */
export function configuration() {
  const env = validateEnv(process.env);
  const isProduction = env.NODE_ENV === 'production';

  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      isProduction,
      corsOrigins: env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    database: {
      url: env.DATABASE_URL,
    },
    redis: {
      url: env.REDIS_URL,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
    },
    throttle: {
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
      limit: env.THROTTLE_LIMIT,
    },
    storage: {
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    log: {
      level: env.LOG_LEVEL,
    },
    swagger: {
      // never expose interactive docs in production
      enabled: env.SWAGGER_ENABLED && !isProduction,
    },
  } as const;
}

export type AppConfig = ReturnType<typeof configuration>;
