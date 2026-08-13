/**
 * Integration tests: the real Nest app against real PostgreSQL and Redis
 * spun up by Testcontainers (Docker required). Serial by design — one app,
 * one database.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test/integration'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Every spec authenticates as a seeded demo account; the seed only creates
  // them when asked, so production seeds stay free of invented users.
  setupFiles: ['<rootDir>/test/integration/setup-env.ts'],
  testTimeout: 180_000,
  maxWorkers: 1,
  clearMocks: true,
};
