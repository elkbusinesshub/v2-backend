# Architecture

## Layered flow

```
HTTP request
  → middleware (helmet, cors, compression, body limits, pino request log)
  → ThrottlerGuard (Redis-backed rate limit)
  → JwtAuthGuard → RolesGuard          (global; @Public() opts out)
  → ValidationPipe (DTO whitelist/transform → VALIDATION_ERROR envelope)
  → Controller     (thin: parse → service → ApiResponse)
  → Service        (business logic; throws DomainException subclasses)
  → Repository     (the ONLY layer touching Prisma — enforced by ESLint)
  → MySQL
  ← EnvelopeInterceptor (success envelope)
  ← AllExceptionsFilter (error envelope, single source of error responses)
```

Rules enforced by lint, not convention:

- Only `*.repository.ts` (plus `src/database`, health probes) may import the
  database layer.
- Controllers hold no business logic and no queries; services never touch
  `req`/`res`.

## Module layout

Feature code is **module-first**: everything for a feature lives in
`src/modules/<feature>/` (controller, service, repository, DTOs). Cross-cutting
infrastructure lives outside `modules/`:

| Path           | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `src/config`   | zod-validated env → typed `AppConfig`; only place reading `process.env` |
| `src/common`   | errors, envelope, guards, decorators, pipes, shared types               |
| `src/database` | extended Prisma client (soft delete), lifecycle, `PRISMA` token         |
| `src/cache`    | shared ioredis client + `CacheService` (read-through JSON cache)        |
| `src/storage`  | `StorageProvider` port + S3 adapter (swap via `StorageModule`)          |
| `src/sockets`  | Redis-adapter Socket.IO, handshake auth, `/system` gateway              |
| `src/jobs`     | BullMQ root config; queues register per feature module                  |

## Auth lifecycle

```
login (future: OTP / Google)     refresh                     logout
──────────────────────────      ─────────────────────       ─────────────────
AuthService.issueTokenPair  →   rotateRefreshToken      →   revoke session
  access JWT (15 min, jti)        find by SHA-256 hash        denylist jti in
  refresh = 384-bit random        reuse? → revoke FAMILY      Redis (TTL = exp)
  stored as SHA-256 hash          atomic claim (updateMany
  one session row / device         where revokedAt IS NULL)
                                  new session, same family
```

Reuse detection: refresh tokens form a rotation chain (`familyId`). A revoked
token being replayed — or losing the atomic claim race — proves duplication;
the entire family is revoked, forcing re-login on the affected device chain.

## Database conventions

- UUID **v7** primary keys (`@default(uuid(7))`) — time-ordered, index-friendly.
- `createdAt` / `updatedAt` everywhere; `deletedAt` on soft-deletable models.
- Soft delete is centralized in `src/database/prisma.extension.ts`: reads
  auto-filter, deletes become updates. Add a model to `SOFT_DELETE_MODELS`
  to opt in. `findUnique` is exempt (use `findFirst` for soft models).
- Transactions: inject `PRISMA` in a repository and use
  `db.$transaction(async (tx) => { … })` for multi-step invariants
  (wallet/ledger operations later).

## Realtime scaling

One Socket.IO server per API instance; the Redis adapter broadcasts
across instances, so `server.to('user:123').emit(...)` reaches the user no
matter which instance holds their socket. Rooms: `user:{id}` (joined at
connect) plus per-feature rooms (`order:{id}`, `ride:{id}`).

## Error handling

`DomainException` subclasses (`UnauthenticatedException`,
`ResourceNotFoundException`, …) carry stable `code`s. The single
`AllExceptionsFilter` maps domain errors, validation failures, Prisma known
errors (P2002→409, P2025→404), and unknown crashes (opaque 500, full stack
logged) to the error envelope. Services throw; nothing else formats errors.

## Graceful shutdown

`app.enableShutdownHooks()` + ECS/K8s SIGTERM → Nest stops accepting,
closes the HTTP server and sockets, then `OnApplicationShutdown` providers
disconnect Prisma and quit Redis. Health `/health/ready` returning 503 pulls
an instance out of the load balancer without killing it.
