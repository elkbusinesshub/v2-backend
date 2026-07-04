# ELK Business Hub — Backend

Production backend foundation for the ELK Business Hub super-app.
**NestJS · TypeScript (strict) · PostgreSQL + Prisma · Redis · Socket.IO · pnpm**

New here? Read [docs/architecture.md](docs/architecture.md) first, then
[docs/conventions.md](docs/conventions.md) before adding a module.

## Quick start

```bash
# 1. prerequisites: Node ≥ 20.11, Docker, corepack enabled
corepack enable

# 2. dependencies
pnpm install

# 3. local Postgres + Redis
docker compose up -d

# 4. environment
cp .env.example .env          # defaults match docker-compose

# 5. database
pnpm db:migrate               # apply migrations (creates them in dev)
pnpm db:seed                  # demo users

# 6. run
pnpm start:dev                # hot reload on :3000
```

- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/docs` (non-production only)
- Health: `/health/live`, `/health/ready`

## Scripts

| Script                           | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `pnpm start:dev`                 | dev server with hot reload                           |
| `pnpm build` / `pnpm start:prod` | compile / run production build                       |
| `pnpm lint` / `pnpm lint:fix`    | ESLint (includes architecture rules)                 |
| `pnpm typecheck`                 | strict `tsc --noEmit`                                |
| `pnpm test`                      | unit tests (mocked boundaries)                       |
| `pnpm test:integration`          | full stack against Testcontainers (needs Docker)     |
| `pnpm db:migrate` / `db:deploy`  | create+apply migrations (dev) / apply only (CI/prod) |
| `pnpm db:seed` / `db:studio`     | seed demo data / browse DB                           |

## Environment

All variables are validated at boot (`src/config/env.validation.ts`) — the
process refuses to start on a missing/malformed environment. See
[.env.example](.env.example) for the full annotated list. Secrets are injected
by the platform in production (AWS Secrets Manager → task env); nothing
secret is ever committed.

## Response contract

Every endpoint returns one envelope:

```jsonc
// success
{ "success": true, "message": "OK", "data": { }, "meta": { "page": 1 } }
// error
{ "success": false, "message": "Validation failed", "error": "VALIDATION_ERROR",
  "details": [{ "field": "phone", "message": "…" }] }
```

`error` codes are a stable machine-readable contract for the mobile app.

## Auth model

- Access token: 15-min JWT (`Authorization: Bearer …`), revocable early via a
  Redis denylist (logout takes effect immediately).
- Refresh token: opaque, stored **hashed**, one session row per device,
  **rotated on every use**; replaying a used token revokes the whole session
  family (stolen-token defense).
- Every route is authenticated **by default**; opting out requires an explicit
  `@Public()`. RBAC via `@Roles(Role.ADMIN)`.

## Realtime

Socket.IO with the Redis adapter (multi-instance fan-out from day one).
Clients authenticate in the handshake: `io(url, { auth: { token } })`.
See `src/sockets/system.gateway.ts` — the template for chat / live location /
notifications gateways.

## Docker

```bash
docker build -t elk-backend .
docker compose --profile full up   # full stack locally
```

Migrations run as a deploy step (`pnpm db:deploy`), never at container start.

## Testing strategy

- **Unit** (`test/unit`): services with repositories/infrastructure mocked at
  their interfaces. Fast, run on every commit.
- **Integration** (`test/integration`): the real HTTP pipeline against real
  Postgres/Redis via Testcontainers — no mocked databases.
