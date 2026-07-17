# Conventions

## Adding a feature module (the checklist)

Create `src/modules/<feature>/` containing:

```
<feature>.module.ts       # wires everything; imported by AppModule
<feature>.controller.ts   # routes + swagger decorators; NO logic
<feature>.service.ts      # business logic; throws DomainExceptions
<feature>.repository.ts   # ALL database access for this feature
<feature>.dto.ts          # class-validator DTOs (request + response)
```

Rules:

1. Controllers return raw data or `ApiResponse.of(data, message, meta)` —
   never hand-built envelopes.
2. Services throw `DomainException` subclasses — never `res.status(...)`.
3. Only `*.repository.ts` imports the `PRISMA` token (lint-enforced).
4. New endpoints are authenticated by default. `@Public()` must be deliberate
   and reviewed. Role-restricted routes use `@Roles(Role.PROVIDER)`.
5. Every model gets `createdAt`/`updatedAt`; user-facing entities that can be
   "removed" get `deletedAt` + an entry in `SOFT_DELETE_MODELS`.
6. Realtime features add their own gateway following
   `src/sockets/system.gateway.ts` (own namespace, handshake auth middleware,
   `user:{id}` room).
7. Background work: `BullModule.registerQueue({ name })` in your module,
   `@Processor(name)` worker class, idempotent job handlers (jobs may retry).

## Naming

- Files: `kebab-case.ts`; classes: `PascalCase`; DB tables: `snake_case`
  via `@@map`; Redis keys: `namespace:...` (`cache:`, `auth:denylist:`, `jobs:`).
- Commits: Conventional Commits (`feat(auth): add OTP verification`) —
  enforced by commitlint.

## Indexing guidelines (MySQL)

- Index every foreign key (`@@index([userId])`) — InnoDB adds one implicitly
  when none exists, but the explicit index keeps it visible in the schema.
- Index columns used in `WHERE` / `ORDER BY` of hot queries; composite indexes
  match the query's column order, most-selective first.
- Soft-deleted tables: queries always filter `deletedAt IS NULL`; MySQL has no
  partial indexes — for large tables lead a composite index with the filter
  column instead, e.g. `@@index([deletedAt, phone])`.
- Never add speculative indexes — they tax every write. Add them with the
  query that needs them, verified by `EXPLAIN ANALYZE`.

## Migrations

- Dev: `npm run db:migrate` (generates SQL under `prisma/migrations/`, reviewed
  in the PR like any code).
- CI/prod: `npm run db:deploy` (applies committed migrations only) as a release
  step, before the new app version starts.
- Never edit an applied migration; write a new one.

## Testing

- Unit specs mirror `src/` under `test/unit/`; mock at the repository /
  infrastructure interface, never mock Prisma internals.
- Integration specs live in `test/integration/` and run the real pipeline
  (Testcontainers). New endpoints ship with at least: happy path, validation
  failure, authz failure.
