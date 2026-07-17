# Developer Handoff — ELK Backend

_Written 2026-07-07. Read together with [progress.md](progress.md) (what's built + roadmap),
[architecture.md](architecture.md) (request pipeline), and [conventions.md](conventions.md)
(how to add a module — follow it exactly, ESLint enforces parts of it)._

## ⚠️ Current git state

The repo has **one commit** (`f8cc557`, the original scaffold). **Everything described in
progress.md is uncommitted working-tree changes** — the MySQL migration, npm switch, and all
six feature modules. First order of business: review the diff and commit (or split into a few
logical commits: `mysql migration`, `npm switch`, `otp auth`, `locations`, `users+services+home`,
`bookings`). Nothing is pushed anywhere.

## Repo map (where to look)

```
prisma/schema.prisma            all models; single init migration (see "Migrations" below)
prisma/seed.ts                  demo users + 4 categories / 12 services (idempotent, upsert by slug)
src/app.module.ts               module registry — every feature module is imported here
src/app.setup.ts                the HTTP pipeline (also used verbatim by integration tests)
src/config/                     env validation (zod) + typed config; add new env vars in BOTH files
src/common/                     envelope, filters, guards, decorators, DomainExceptions, utils
src/database/prisma.extension.ts  soft-delete magic — add models to SOFT_DELETE_MODELS
src/modules/auth/               OTP login, token rotation, denylist (otp.service.ts logs the OTP!)
src/modules/users/              profile get/patch
src/modules/locations/          saved-address CRUD (exports its repository for reuse)
src/modules/services/           home-services catalogue + booking-window.ts (shared slot rules)
src/modules/home/               /home/feed aggregation (no tables of its own)
src/modules/bookings/           booking create/list/cancel
test/unit/<module>/             mirrors src; mock at repository interfaces, never Prisma
test/integration/               real MySQL+Redis via Testcontainers (needs Docker)
postman/                        import both files; requests chain via saved variables
```

## Daily workflow

```bash
docker compose up -d                       # MySQL :3307, Redis :6380 (offset ports on purpose)
npm run start:dev                          # hot reload; Swagger at http://localhost:3000/docs
npm run typecheck && npm test && npm run lint   # the pre-PR trio (all green right now: 40 tests)
npm run test:integration                   # slower; requires Docker running
```

**Login while testing:** `POST /api/v1/auth/otp/request` with any E.164 phone, then read the
4-digit code from the **server console** (`OTP for +9715...: 1234`) — there is no SMS provider
yet. Verify at `/auth/otp/verify` → you get the token pair. The Postman collection automates
storing tokens; only the OTP itself is manual.

## Migrations — important, non-standard for now

The app has never been deployed, so instead of stacking migrations we **regenerate the single
init migration** whenever the schema changes:

```powershell
$env:DATABASE_URL="mysql://dummy:dummy@localhost:3306/dummy"   # diff runs offline, any URL works
npx prisma migrate diff --from-empty --to-schema-datamodel prisma\schema.prisma --script `
  > prisma\migrations\20260705000000_init\migration.sql        # keep the file BOM-free (UTF-8)
npx prisma generate
```

After regenerating, local DBs must be reset:
`docker compose down -v && docker compose up -d && npm run db:deploy && npm run db:seed`

**The moment this deploys to any shared environment, stop doing this** and switch to normal
additive `npm run db:migrate` — regenerating an applied migration corrupts migrate state.

## Machine-specific gotchas (the original dev machine)

- Node is installed at `C:\Users\MEGHA V\` (not Program Files). `corepack enable` fails there
  with EPERM — irrelevant now since the project uses **npm**, but don't try to shim pnpm.
- Docker Desktop must be started manually (GUI) before `docker compose up` works.
- PowerShell 5.1: `Out-File -Encoding utf8` writes a BOM. Prisma migration SQL must be BOM-free
  (see the WriteAllText re-encode pattern used above, or write files with another tool).

## Things that are deliberately stubbed (don't mistake them for done)

| Stub                                                           | Where                                   | Becomes real when                             |
| -------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| OTP "sending" = log line                                       | `auth/otp.service.ts` `issue()`         | SMS provider chosen (one-method swap)         |
| Provider name/experience/rating/reviews/bookings on services   | seeded columns on `Service`             | provider + review modules exist               |
| Time slots all-available, fixed grid                           | `services/booking-window.ts`            | provider schedules exist                      |
| Promo banner + `pricing.promoDiscount = 0`                     | `home/home.service.ts`, booking options | promo engine exists                           |
| Bookings `CONFIRMED` immediately, `amountPaid` without payment | `bookings/bookings.service.ts`          | payment gateway integrated (decision pending) |

## Flutter app (`../v2-flutter`) — read before wiring

- **Zero real HTTP calls.** Every repository routes through `ApiClient.simulate()` which sleeps
  and returns fixtures from `lib/data/datasources/dummy_data.dart`. `Dio` is configured but unused.
- Auth/session storage is a SharedPreferences boolean — no tokens are stored anywhere. Wiring
  order that makes sense: secure token storage → Dio auth interceptor (attach bearer, refresh on 401) → swap repositories one at a time (auth first). Backend response shapes were built to match
  the existing Flutter `fromJson` models field-for-field, so the swaps should be mechanical.
- The endpoints the app expects that don't exist yet are listed in progress.md §3 (each vertical —
  rides/elkstay/rentals/porter — is its own future backend module by design).
- The map picker draws a fake map (`CustomPainter`); real maps SDK + GPS packages are not yet in
  `pubspec.yaml`. Address text + lat/lng are resolved client-side by decision — the backend never
  geocodes.

## Conventions that bite if missed

- Only `*.repository.ts` may touch Prisma (`PRISMA` token) — **lint-enforced**, the build fails.
- Every route is authenticated by default (global guard). `@Public()` is deliberate and reviewed.
- Services throw `DomainException` subclasses; controllers stay logic-free; the envelope
  interceptor / exceptions filter produce the wire format — never hand-build `{ success: ... }`.
- Ownership checks live in the query (`WHERE id AND userId`), returning 404 for foreign rows —
  don't fetch-then-compare.
- Money: `Decimal(10,2)` in the DB, `.toNumber()` at the DTO boundary (Decimal JSON-serializes
  as a string otherwise, which breaks the Flutter `as num` casts).
- New env vars go in `src/config/env.validation.ts` **and** `configuration.ts` **and** `.env.example`.
- Commits: Conventional Commits, enforced by commitlint via husky.
