# API: Cleaning, Repair and Admin

Reference for the endpoints added in September 2026 for ELK's own cleaning and
repair services and for the admin panel. Everything else in the API is
unchanged and is covered by the Postman collection (`postman/`).

- Base URL: `https://api.elkcompany.online/api/v1` (local: `http://localhost:3001/api/v1`)
- Auth: `Authorization: Bearer <accessToken>` on every endpoint here, from
  `POST /auth/otp/request` then `POST /auth/otp/verify`.
- Admin endpoints also need the **ADMIN** role. The role is granted at login
  to phones listed in the server's `ADMIN_PHONES`. A token without it gets
  `403 FORBIDDEN`.
- Money is in rupees, as numbers. Dates are Indian calendar days, `YYYY-MM-DD`.

## Response envelope

Success:

```json
{ "success": true, "message": "OK", "data": {} }
```

Failure:

```json
{
  "success": false,
  "message": "Human-readable reason",
  "error": "MACHINE_CODE",
  "details": [{ "field": "hours", "message": "…" }]
}
```

`message` on the errors below is written for the customer or admin, so a client can show it as it is.

## Contents

1. [How pricing works](#1-how-pricing-works)
2. [Home services: customer app](#2-home-services-customer-app)
3. [Admin](#3-admin)
4. [Other changes](#4-other-changes)
5. [Error codes](#5-error-codes)

---

## 1. How pricing works

A service has a minimum number of hours, a rate per hour for the first
professional, a rate per hour for each extra professional, and an optional
materials fee. For repair, the materials fee is the spare-parts fee.

```
base      = hourlyRate × hours + extraProRate × hours × (professionals − 1)
materials = withMaterials ? materialsFee : 0          (only if materialsFee > 0)
subtotal  = base + materials
discount  = min(round(subtotal × percent / 100), maxDiscount)   (no cap when maxDiscount = 0)
total     = subtotal − discount
```

"From" price shown in the app = `hourlyRate × minHours` (one professional).

Example: Bathroom deep clean, rate ₹349, extra pro ₹299, materials ₹149. For 3 hours, 2 professionals, with materials and code `WELCOME15` (15%, cap ₹300):

| Step      | Working                     | Amount     |
| --------- | --------------------------- | ---------- |
| Base      | 349 × 3 + 299 × 3           | ₹1,944     |
| Materials |                             | ₹149       |
| Subtotal  | 1,944 + 149                 | ₹2,093     |
| Discount  | 15% is ₹314, capped at ₹300 | ₹300       |
| **Total** | 2,093 − 300                 | **₹1,793** |

The server always prices a booking itself from the stored rates. What the app shows is a preview of the same calculation.

## 2. Home services: customer app

### Booking lifecycle

```
PENDING ──(admin assigns a professional)──▶ CONFIRMED ──(admin starts)──▶ IN_PROGRESS ──(admin completes)──▶ COMPLETED
   │                                           │
   └────────(customer or admin cancels)────────┴──────────────────────────▶ CANCELLED
```

- The customer can cancel while `PENDING` or `CONFIRMED`.
- The customer receives a notification at every step the admin takes.

### `GET /services`

Services live in the app, meaning both active and online.

| Query      |          |                        |
| ---------- | -------- | ---------------------- |
| `vertical` | optional | `CLEANING` or `REPAIR` |

Response `data`: an array of:

```json
{
  "id": "01a0e6…",
  "vertical": "CLEANING",
  "category": "bth",
  "name": "Bathroom deep clean",
  "description": "Descaling tiles, fittings, mirrors and floor scrubbing.",
  "minHours": 2,
  "hourlyRate": 349,
  "extraProRate": 299,
  "materialsFee": 149,
  "fromPrice": 698
}
```

`category` is the app tile the service sits under:

| Vertical | Categories                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| CLEANING | `cln` home, `deep` deep, `tnk` water tank, `sof` sofa, `crp` carpet, `kit` kitchen, `bth` bathroom, `lndr` laundry |
| REPAIR   | `ac` AC, `plm` plumbing, `elc` electrical, `cpt` carpentry, `pnt` painting, `gen` handyman                         |

### `POST /promo-codes/check`

What a code takes off an order of a given size. Always returns 200, with `ok` telling whether the code applies.

Request:

```json
{ "code": "welcome15", "subtotal": 1944 }
```

Response `data`:

```json
{ "ok": true, "discount": 292, "message": "WELCOME15 applied. 15% off." }
```

When a code doesn't apply, `ok` is `false`, `discount` is `0`, and `message` says why:

| Reason                  | Message                                               |
| ----------------------- | ----------------------------------------------------- |
| Unknown code            | `NOPE isn't a valid code.`                            |
| Expired                 | `ONAM20 has expired.`                                 |
| Switched off            | `ONAM20 can't be used right now.`                     |
| Below the minimum order | `ONAM20 needs a minimum order of ₹999. Add ₹99 more.` |

### `POST /service-bookings`

Books one service. Returns `201`.

Request:

```json
{
  "serviceId": "01a0e6…",
  "hours": 3,
  "professionals": 2,
  "withMaterials": true,
  "date": "2026-10-02",
  "timeSlot": "11:00",
  "addressId": "01a0…",
  "promoCode": "WELCOME15"
}
```

| Field           | Rules                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `serviceId`     | A live service                                                             |
| `hours`         | Whole number, from the service's `minHours` up to 12                       |
| `professionals` | 1 to 4                                                                     |
| `withMaterials` | Optional. Ignored when the service's `materialsFee` is 0                   |
| `date`          | `YYYY-MM-DD`, today or later (India)                                       |
| `timeSlot`      | `HH:MM`. The app offers 09:00, 11:00, 13:00, 15:00, 17:00, 19:00           |
| `addressId`     | One of the caller's saved addresses (`/locations`)                         |
| `promoCode`     | Optional. A code that doesn't apply rejects the whole booking (see errors) |

The address must fall inside an active service location. That means either within the location's radius of its centre, or carrying its pincode in the address text. Its flat number and building are included in the booking's `addressText`, and its directions are copied onto the booking.

Response `data`: a **booking**, the same shape the admin sees:

```json
{
  "id": "01a0e7…",
  "code": "ELK-S-NDJMR",
  "status": "PENDING",
  "serviceId": "01a0e6…",
  "serviceName": "Bathroom deep clean",
  "vertical": "CLEANING",
  "category": "bth",
  "hours": 3,
  "professionals": 2,
  "withMaterials": true,
  "date": "2026-10-02",
  "timeSlot": "11:00",
  "addressLabel": "Home",
  "addressText": "12B, Prestige Tower, 80 Feet Rd, Koramangala, Bengaluru, Karnataka 560034, India",
  "lat": 12.9352,
  "lng": 77.6245,
  "directions": "Gate 2",
  "contactPhone": "+918888888888",
  "customerName": "Anjali Menon",
  "location": {
    "id": "01a0e6…",
    "area": "Koramangala",
    "district": "Bengaluru",
    "pincode": "560034"
  },
  "professional": null,
  "baseAmount": 1944,
  "materialsAmount": 149,
  "discountAmount": 300,
  "totalAmount": 1793,
  "promoCode": "WELCOME15",
  "createdAt": "2026-09-28T07:40:12.000Z"
}
```

`professional` is `{ id, name, phone }` once assigned.

Errors:

| Status | `error`            | When                                                                                                    |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------- |
| 404    | `NOT_FOUND`        | Service missing, offline or inactive; address not the caller's                                          |
| 400    | `VALIDATION_ERROR` | Fewer hours than `minHours`; date in the past; bad field                                                |
| 422    | `AREA_NOT_SERVED`  | No active location covers the address. Message: `We don't serve this address yet. Try another address.` |
| 422    | `PROMO_REJECTED`   | The promo code does not apply. The message is the reason, as in `/promo-codes/check`                    |

### `POST /service-bookings/:id/cancel`

The customer cancels their own booking. Returns the booking with `status: "CANCELLED"`.

| Status | `error`              | When                                              |
| ------ | -------------------- | ------------------------------------------------- |
| 404    | `NOT_FOUND`          | No such booking, or it is someone else's          |
| 409    | `INVALID_TRANSITION` | Already `IN_PROGRESS`, `COMPLETED` or `CANCELLED` |

### `GET /bookings` (changed)

The existing "My bookings" list now also includes service bookings:

- `vertical` is `"service"`.
- `categorySlug` is `"cleaning"` or `"repairing"`.
- `providerName` is the assigned professional, or "ELK Clean" / "ELK Repair" until one is assigned.
- `scheduledAt` is the date and window as an instant.

Cancel these through `POST /service-bookings/:id/cancel`.

---

## 3. Admin

All routes are under `/admin` and need the ADMIN role.

### `GET /admin/dashboard`

```json
{
  "monthBookings": 42,
  "monthRevenue": 61240,
  "pendingCount": 3,
  "servicesLive": 12,
  "servicesTotal": 13,
  "activeDistricts": 2,
  "team": { "available": 5, "onJob": 1, "offDuty": 1 },
  "pending": [/* bookings, PENDING */],
  "todayJobs": [/* bookings scheduled today, CONFIRMED or IN_PROGRESS */]
}
```

| Field           | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `monthBookings` | Bookings created this month, excluding cancelled ones   |
| `monthRevenue`  | Total of bookings completed this month, after discounts |

### Services

| Method | Path                  | Body                      | Returns          |
| ------ | --------------------- | ------------------------- | ---------------- |
| GET    | `/admin/services`     | none                      | all services     |
| POST   | `/admin/services`     | service (below)           | 201, the service |
| PATCH  | `/admin/services/:id` | any fields of the service | the service      |
| DELETE | `/admin/services/:id` | none                      | 204              |

Body:

```json
{
  "vertical": "CLEANING",
  "category": "bth",
  "name": "Balcony & window clean",
  "description": "Glass, frames, grills and balcony floor.",
  "minHours": 2,
  "hourlyRate": 299,
  "extraProRate": 249,
  "materialsFee": 99,
  "active": true,
  "online": true
}
```

**Field rules:**

- `category` must be a tile of the vertical (see section 2), otherwise 400.
- `minHours` is 1 to 12.
- `hourlyRate` must be at least 1; `extraProRate` and `materialsFee` at least 0.

**How changes take effect:**

- `active` and `online` default to `true` on create.
- An inactive service is always offline.
- Changes are live in the app immediately. Approval by a super admin is planned.

**Deleting:** existing bookings keep their snapshot of the name and price, and still go ahead.

Admin service shape: the app shape plus:

```json
{ "active": true, "online": true, "live": true, "openBookings": 2, "updatedAt": "…" }
```

### Locations (service areas)

| Method | Path                   | Body                       | Returns           |
| ------ | ---------------------- | -------------------------- | ----------------- |
| GET    | `/admin/locations`     | none                       | all locations     |
| POST   | `/admin/locations`     | location (below)           | 201, the location |
| PATCH  | `/admin/locations/:id` | any fields of the location | the location      |

Body:

```json
{
  "area": "Koramangala",
  "district": "Bengaluru",
  "pincode": "560034",
  "radiusKm": 6,
  "active": true
}
```

- `pincode` is 6 digits.
- `radiusKm` is 1 to 50.
- The server looks the area up on Google Maps when it is saved:
  - Found: `mapped: true`, and bookings match by radius.
  - Not found: it still saves, and matches by pincode only.
- Setting `active: false` stops new bookings there.

Shape:

```json
{
  "id": "…",
  "area": "Koramangala",
  "district": "Bengaluru",
  "pincode": "560034",
  "radiusKm": 6,
  "mapped": true,
  "active": true,
  "professionals": 3,
  "pendingBookings": 1
}
```

### Professionals

| Method | Path                       | Body                           | Returns                                                                  |
| ------ | -------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| GET    | `/admin/professionals`     | none                           | all professionals                                                        |
| POST   | `/admin/professionals`     | professional (below)           | 201, the professional                                                    |
| PATCH  | `/admin/professionals/:id` | any fields of the professional | the professional                                                         |
| DELETE | `/admin/professionals/:id` | none                           | 204; 409 `HAS_ASSIGNMENTS` while they have confirmed or in-progress jobs |

Body:

```json
{
  "name": "Anil Kumar",
  "phone": "+91 98470 21456",
  "experienceYears": 5,
  "skills": "Home, Bathroom",
  "locationId": "…",
  "onDuty": true
}
```

`locationId` may be `null` for no base location.

Shape:

```json
{
  "id": "…",
  "name": "Anil Kumar",
  "phone": "+91 98470 21456",
  "experienceYears": 5,
  "skills": "Home, Bathroom",
  "location": { "id": "…", "area": "Koramangala", "district": "Bengaluru" },
  "onDuty": true,
  "status": "AVAILABLE",
  "jobsToday": 2
}
```

`status`:

| Value       | Meaning                             |
| ----------- | ----------------------------------- |
| `AVAILABLE` | On duty and not on a job            |
| `ON_JOB`    | On duty, with a booking in progress |
| `OFF_DUTY`  | Switched off duty                   |

### Promo codes

| Method | Path                     | Body                   | Returns                               |
| ------ | ------------------------ | ---------------------- | ------------------------------------- |
| GET    | `/admin/promo-codes`     | none                   | all codes                             |
| POST   | `/admin/promo-codes`     | code (below)           | 201, the code; 409 if the code exists |
| PATCH  | `/admin/promo-codes/:id` | any fields of the code | the code                              |
| DELETE | `/admin/promo-codes/:id` | none                   | 204                                   |

Body:

```json
{
  "code": "WELCOME15",
  "percent": 15,
  "maxDiscount": 300,
  "minOrder": 499,
  "validTill": "2026-12-31",
  "active": true,
  "description": "First booking"
}
```

**Field rules:**

| Field         | Rule                                                   |
| ------------- | ------------------------------------------------------ |
| `code`        | 4 to 15 letters or digits; stored upper-case           |
| `percent`     | 1 to 90                                                |
| `maxDiscount` | `0` means no cap                                       |
| `validTill`   | The last usable day, inclusive. Must be today or later |

**Switching an expired code back on:** returns 409 `PROMO_EXPIRED`. Send a new `validTill` in the same request.

Shape adds `state`, which is `ACTIVE`, `INACTIVE` or `EXPIRED`.

### Bookings

| Method | Path                             | Body                          | Returns                                                 |
| ------ | -------------------------------- | ----------------------------- | ------------------------------------------------------- |
| GET    | `/admin/bookings?status=PENDING` | none                          | up to 500 bookings, newest day first; `status` optional |
| PATCH  | `/admin/bookings/:id/assign`     | `{ "professionalId": "…" }`   | the booking, now `CONFIRMED`                            |
| PATCH  | `/admin/bookings/:id/status`     | `{ "status": "IN_PROGRESS" }` | the booking                                             |

**Assign:**

- Works from `PENDING`, which it confirms, or from `CONFIRMED`, which reassigns.
- The professional must be on duty, otherwise 409 `OFF_DUTY`.

**Status:** allowed moves:

| From          | To                                                                              |
| ------------- | ------------------------------------------------------------------------------- |
| `PENDING`     | `CANCELLED`                                                                     |
| `CONFIRMED`   | `IN_PROGRESS` (needs a professional, otherwise 409 `NOT_ASSIGNED`), `CANCELLED` |
| `IN_PROGRESS` | `COMPLETED`                                                                     |

Anything else is 409 `INVALID_TRANSITION`.

**Notifications:** the customer gets a push and in-app notification for:

- assign ("Booking confirmed" / "Professional changed")
- start
- completion
- cancellation

---

## 4. Other changes

### Addresses: `POST /locations`, `PATCH /locations/:id`

Three optional fields were added, and are returned on every address:

```json
{ "building": "Prestige Tower", "flatNumber": "12B", "directions": "Gate 2, take the lift" }
```

| Field        | Max length |
| ------------ | ---------- |
| `building`   | 120        |
| `flatNumber` | 40         |
| `directions` | 500        |

`label` carries Home, Work or Other.

### Tile pricing (superseded)

`GET /cleaning/pricing`, `PUT /cleaning/pricing/:tile`, `GET /repair/pricing` and `PUT /repair/pricing/:tile` set per-tile hourly prices. So do the `hours`, `professionals`, `withMaterials` and `withParts` fields on marketplace orders. All were added on 25–26 Sep and still work, but the app no longer uses them: cleaning and repair are booked through `/service-bookings`.

---

## 5. Error codes

| Code                 | Status | Where                                                             |
| -------------------- | ------ | ----------------------------------------------------------------- |
| `VALIDATION_ERROR`   | 400    | Any bad field; `details` lists each one                           |
| `UNAUTHENTICATED`    | 401    | Missing or expired token                                          |
| `FORBIDDEN`          | 403    | Admin route without the ADMIN role                                |
| `NOT_FOUND`          | 404    | Missing service, booking, address, location, professional or code |
| `CONFLICT`           | 409    | Promo code already exists                                         |
| `INVALID_TRANSITION` | 409    | Booking status move not allowed                                   |
| `NOT_ASSIGNED`       | 409    | Starting a job with nobody assigned                               |
| `OFF_DUTY`           | 409    | Assigning someone who is off duty                                 |
| `HAS_ASSIGNMENTS`    | 409    | Removing a professional with open jobs                            |
| `PROMO_EXPIRED`      | 409    | Re-activating an expired code without a new date                  |
| `AREA_NOT_SERVED`    | 422    | Booking address outside every active location                     |
| `PROMO_REJECTED`     | 422    | Booking with a promo code that does not apply                     |
