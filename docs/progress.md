# ELK Business Hub — Progress & Roadmap

_Last updated: 2026-07-07_

Two codebases:

- **`v2-backend`** — NestJS API (this repo). This is where all recent work happened.
- **`v2-flutter`** — the mobile app. UI is complete for many screens, but **every API call
  is still simulated** against dummy data (`lib/data/datasources/api_client.dart`).

---

## 1. Done so far

### Platform / infrastructure changes

| Change                    | Detail                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL → MySQL**    | Prisma provider swapped, `Char(36)` UUIDs, enum-array `roles` replaced with a JSON column (narrowed back to `Role[]` at the auth boundary), migration regenerated, docker-compose runs `mysql:8.4` on host port **3307**, integration tests use `@testcontainers/mysql`. |
| **pnpm → npm**            | `package-lock.json`, husky hooks, Dockerfile, CI workflow, docs all converted. Plain `npm run …` works everywhere.                                                                                                                                                       |
| **Password auth removed** | Login is **phone + OTP only**. `passwordHash` column, `PasswordService`, and the `argon2` dependency were deleted.                                                                                                                                                       |
| **Postman collection**    | `postman/` has a collection + environment covering every endpoint, with scripts that auto-save tokens/ids between requests.                                                                                                                                              |

### Feature modules built (`src/modules/`)

| Module        | Endpoints                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **auth**      | `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` | 4-digit OTP in Redis (5 min TTL, 30 s resend cooldown, 5-attempt cap). Verify = login **and** signup (user auto-created on first login). 15-min JWT access tokens + 30-day rotating refresh tokens with family-revocation reuse detection + instant-logout denylist. **No SMS provider yet — the OTP is printed in the server log.**                       |
| **users**     | `GET /users/me` · `PATCH /users/me`                                                                              | Profile (id, phone, email, name, language, roles). PATCH is how a fresh OTP user sets their name. `language` column added (default `en`).                                                                                                                                                                                                                  |
| **locations** | `GET /locations` · `POST /locations` · `PATCH /locations/:id` · `DELETE /locations/:id`                          | Saved-address book. Coordinates + address text are resolved **client-side** (decision: no server geocoding). One default per user enforced transactionally; ownership checks return 404 for other users' rows; soft delete.                                                                                                                                |
| **services**  | `GET /services` · `GET /services/:id` · `GET /services/:id/booking-options`                                      | Home-services catalogue only (Cleaning, Laundry, AC Service, Repairing — 12 seeded services). Response shapes match the Flutter models exactly. Booking options: real dates (tomorrow + 4), fixed time slots, the user's default address prefilled, price from DB. Provider/rating fields are seeded display values until provider & review modules exist. |
| **home**      | `GET /home/feed`                                                                                                 | Aggregation: greeting (profile), location (default address), static promo banner, the 6 vertical nav tiles, best sellers derived from top-rated catalog services. Owns no tables.                                                                                                                                                                          |
| **bookings**  | `POST /bookings` · `GET /bookings` · `POST /bookings/:id/cancel`                                                 | First real order flow. Server computes the price (client `total` ignored), validates day/time against the same window services advertises, unique `ELK-YYYY-NNNNN` references, atomic cancel (409 if already cancelled/completed). Status is `CONFIRMED` on create until payments exist.                                                                   |

### Database schema (MySQL, Prisma)

`User` · `RefreshSession` · `Address` · `ServiceCategory` · `Service` · `Booking` (+ `Role`, `BookingStatus` enums).
Conventions: UUID v7 PKs, `createdAt/updatedAt` everywhere, soft delete (`deletedAt`) on `User`/`Address`, snake_case tables, money as `Decimal(10,2)`.

### Quality

- **40 unit tests** across 6 suites (auth, users, locations, services, home, bookings) — all passing.
- Integration suite (real MySQL + Redis via Testcontainers) covers the auth flow end-to-end — needs Docker running.
- `npm run typecheck` and `npm run lint` clean. CI workflow (GitHub Actions) converted to npm.

### Architecture decisions log

1. **MySQL** instead of PostgreSQL (user decision). Roles stored as JSON since MySQL has no array columns.
2. **OTP-only auth** — no passwords, no Google sign-in.
3. **Client-side geocoding** — the app's maps SDK resolves lat/lng → address; backend only stores.
4. **One module per vertical** — Taxi, ELK Stay, Car Rental, Porter each get their own future module; the current `services` module is only home-services.
5. **Server is the price authority** — booking totals are computed from the DB, never trusted from the client.

---

## 2. How to run

```bash
docker compose up -d          # MySQL (3307) + Redis (6380)
cp .env.example .env          # first time only
npm install                   # first time only
npm run db:deploy && npm run db:seed
npm run start:dev             # API on http://localhost:3000, Swagger at /docs
```

If the schema changed since your DB was created (it did, several times):
`docker compose down -v && docker compose up -d && npm run db:deploy && npm run db:seed`

Test with Postman: import both files in `postman/`, run **Auth → 1. Request OTP**, read the
OTP from the server console, set it in the environment, then run the rest top-to-bottom.

---

## 3. What's next (recommended order)

### Tier 1 — make the app real

1. **Flutter API wiring** (biggest impact; nothing above is visible in the app until this).
   - `flutter_secure_storage` for the token pair
   - Dio interceptor: attach `Authorization: Bearer`, auto-refresh on 401, logout on refresh failure
   - Swap `simulate()` → real `dio` calls repository-by-repository (auth → users → home → services → locations → bookings)
   - Real maps SDK + GPS (`google_maps_flutter` / `geolocator`) for the location picker, which currently draws a fake map
2. **SMS provider for OTP** — one-method change in `OtpService.issue()` (Twilio / MSG91 / SNS / …). Needed before any real user can log in.

### Tier 2 — product completeness

3. **Reviews** — `POST /bookings/:id/reviews`, review targets; starts replacing seeded rating fields with real aggregates.
4. **Notifications** — table + `GET /notifications`, `mark-all-read`; push delivery (FCM) later.
5. **Offers / config** — `GET /offers`, `GET /config/languages` (mostly static content, quick).
6. **Payments & wallet** — `payments/methods`, `charge`, `wallet` + ledger. ⚠️ Blocked on a decision: **which payment gateway?** (Stripe, Telr, PayTabs, Razorpay…). Until then bookings stay pay-on-delivery-style `CONFIRMED`.

### Tier 3 — second persona & verticals (each is its own project)

7. **Provider app surface** — registration, dashboard, earnings, schedule, request accept/reject (`PROVIDER` role already exists).
8. **Vertical modules**, one at a time: `rides/` (taxi types, request, estimate), `elkstay/` (stays, stay detail, stay bookings), `rentals/` (car fleet), `porter/` (options, bookings).
9. **Realtime** — order tracking + chat over Socket.IO (`src/sockets/` is already scaffolded with Redis adapter + handshake auth); live location for rides.

### Ongoing / when convenient

- Real provider & availability models (replaces the fixed time-slot grid and seeded provider fields)
- Promo-code engine (booking options already return a `pricing` block shaped for it)
- Deployment target + secrets (Dockerfile and CI are ready; no infra chosen yet)
- `/auth/guest` decision — recommend keeping guests client-side only (browse without a session)
