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
  // Porter and rides are on hold while the product focuses on cleaning,
  // repair, ELK Stay and ELK Rental. Their specs stay in the repo; remove a
  // line here to run it again.
  testPathIgnorePatterns: ['/node_modules/', 'porter\\.e2e-spec\\.ts$', 'rides\\.e2e-spec\\.ts$'],
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
