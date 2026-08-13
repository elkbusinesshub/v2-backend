/**
 * Environment every integration spec needs before it boots the app.
 *
 * `execSync('npx prisma db seed')` and the Nest config both inherit this
 * process's env, so setting it here reaches them in every spec without each
 * one having to remember.
 */

// The seed creates demo accounts only when asked, so production seeds stay
// free of invented users. Every spec authenticates as one of them.
process.env.SEED_DEMO_USERS = 'true';

// Never call the real SMS gateway from a test. Left on, `/auth/otp/request`
// answers 502 when the gateway rejects the request, and the OTP flow cannot be
// exercised at all.
process.env.SMS_ENABLED = 'false';
