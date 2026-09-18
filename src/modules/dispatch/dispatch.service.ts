import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DriverService, DriverVerification, type DriverProfile } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { PorterCatalogRepository } from '@/modules/porter/porter-catalog.repository';
import { RideTypesRepository } from '@/modules/rides/ride-types.repository';
import {
  DISPATCH_RADIUS_KM,
  MAX_DRIVER_AGE_YEARS,
  MAX_LICENCE_YEARS_AHEAD,
  MAX_OFFERS_PER_REQUEST,
  MILLISECONDS_PER_YEAR,
  MIN_DRIVER_AGE_YEARS,
  PICKUP_OTP_LENGTH,
} from './dispatch.constants';
import type {
  DriverLocationDto,
  NearbyQueryDto,
  NearbyVehicleDto,
  RegisterDriverDto,
  SetOnlineDto,
} from './dispatch.dto';
import { DispatchGateway } from './dispatch.gateway';
import { DispatchRepository, type DriverWithName } from './dispatch.repository';

/** What a partner needs to decide whether to take a job. */
export interface JobOffer {
  bookingId: string;
  service: DriverService;
  code: string;
  pickupAddress: string;
  dropAddress: string;
  fare: number;
  distanceKm: number;
  /** How far the partner is from the pickup, not the length of the trip. */
  pickupDistanceKm: number;
  expiresInSeconds: number;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly drivers: DispatchRepository,
    private readonly gateway: DispatchGateway,
    private readonly rideTypes: RideTypesRepository,
    private readonly porterCatalog: PorterCatalogRepository,
  ) {}

  // ─── the partner's own profile ─────────────────────────────────────────────

  /**
   * Registers, or updates, a partner: who they are, what they drive, and the
   * documents behind both.
   *
   * The class is checked against the live catalogue rather than trusted: a
   * partner registered under a slug no dispatch will ever search for would sit
   * online forever and never be offered anything.
   *
   * Re-registering resets `verification` to PENDING. A partner who changes
   * their licence number or swaps the photographs has not been checked against
   * the new ones, and carrying a VERIFIED flag across that would make the flag
   * mean nothing.
   *
   * **Duty is not gated on verification today.** A PENDING partner can still go
   * online and be dispatched; the status is recorded and shown, and the check
   * is one condition in `setOnline` if that is wanted.
   */
  async register(user: AuthUser, dto: RegisterDriverDto): Promise<Record<string, unknown>> {
    await this.assertVehicleClass(dto.service, dto.vehicleSlug);
    const dateOfBirth = this.assertOldEnough(dto.dateOfBirth);
    const licenceExpiry = this.assertLicenceInDate(dto.licenceExpiry);
    const profile = await this.drivers.upsertProfile(user.id, dto.service, {
      vehicleSlug: dto.vehicleSlug,
      vehicleLabel: dto.vehicleLabel,
      plateNumber: dto.plateNumber.toUpperCase(),
      fullName: dto.fullName.trim(),
      dateOfBirth,
      gender: dto.gender,
      licenceNumber: dto.licenceNumber.toUpperCase().replace(/\s+/g, ''),
      licenceExpiry,
      licenceFrontKey: dto.licenceFrontKey,
      licenceBackKey: dto.licenceBackKey,
      vehicleDocKey: dto.vehicleDocKey,
      verification: DriverVerification.PENDING,
    });
    this.logger.log(`driver registered: user=${user.id} service=${dto.service} (pending review)`);
    return this.toProfileJson(profile);
  }

  /**
   * The date of birth, once it is a real date and old enough to hold a licence.
   *
   * `@IsDateString` proves it is a date, not that it is a *possible* one — it
   * accepts tomorrow, and it accepts 1850.
   */
  private assertOldEnough(value: string): Date {
    const dateOfBirth = new Date(value);
    if (Number.isNaN(dateOfBirth.getTime())) {
      throw new ValidationFailedException([
        { field: 'dateOfBirth', message: 'dateOfBirth is not a real date' },
      ]);
    }
    const now = new Date();
    const age = (now.getTime() - dateOfBirth.getTime()) / MILLISECONDS_PER_YEAR;
    if (age < MIN_DRIVER_AGE_YEARS) {
      throw new ValidationFailedException([
        {
          field: 'dateOfBirth',
          message: `a partner must be at least ${MIN_DRIVER_AGE_YEARS} years old`,
        },
      ]);
    }
    if (age > MAX_DRIVER_AGE_YEARS) {
      throw new ValidationFailedException([
        { field: 'dateOfBirth', message: 'dateOfBirth does not look right' },
      ]);
    }
    return dateOfBirth;
  }

  /**
   * The licence expiry, once it is a real date that has not passed.
   *
   * Refusing an expired licence at the door is the point of collecting it: a
   * document that stopped being valid last year proves nothing, and storing it
   * as though it did would leave the check to nobody.
   */
  private assertLicenceInDate(value: string): Date {
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) {
      throw new ValidationFailedException([
        { field: 'licenceExpiry', message: 'licenceExpiry is not a real date' },
      ]);
    }
    const now = new Date();
    if (expiry.getTime() <= now.getTime()) {
      throw new ValidationFailedException([
        { field: 'licenceExpiry', message: 'this licence has expired' },
      ]);
    }
    const yearsAhead = (expiry.getTime() - now.getTime()) / MILLISECONDS_PER_YEAR;
    if (yearsAhead > MAX_LICENCE_YEARS_AHEAD) {
      throw new ValidationFailedException([
        { field: 'licenceExpiry', message: 'licenceExpiry does not look right' },
      ]);
    }
    return expiry;
  }

  async listProfiles(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.drivers.findProfilesForUser(user.id)).map((p) => this.toProfileJson(p));
  }

  /**
   * Goes on or off duty.
   *
   * Going offline never abandons a job already accepted — `activeBookingId` is
   * what marks a partner busy, and it is cleared by finishing or cancelling the
   * trip, not by a toggle.
   *
   * Going *on* duty with a lapsed licence is refused. Dispatch already skips
   * such a partner, so without this they would sit online all day being
   * offered nothing and never learn why.
   */
  async setOnline(user: AuthUser, dto: SetOnlineDto): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user.id, dto.service);
    if (dto.isOnline) {
      this.assertLicenceStillValid(profile);
    }
    const updated = await this.drivers.update(profile.id, {
      isOnline: dto.isOnline,
      // A fix taken as they go on duty makes them dispatchable immediately,
      // rather than only after the first heartbeat lands.
      ...(dto.lat !== undefined && dto.lng !== undefined
        ? { lat: dto.lat, lng: dto.lng, lastSeenAt: new Date() }
        : {}),
    });

    // Going on duty puts the marker up straight away rather than at the next
    // heartbeat; going off takes it down straight away rather than leaving a
    // rider looking at somebody who has gone home.
    const lat = updated.lat === null ? null : Number(updated.lat);
    const lng = updated.lng === null ? null : Number(updated.lng);
    if (lat !== null && lng !== null) {
      if (updated.isOnline && !updated.activeBookingId) {
        await this.broadcastPosition(updated, lat, lng);
      } else {
        this.gateway.emitVehicleGone(updated.service, lat, lng, updated.id);
      }
    }
    return this.toProfileJson(updated);
  }

  /**
   * Refuses duty to a partner whose licence has run out, or who has none.
   *
   * Compared against the start of today, not this instant: a licence is valid
   * through the day it expires, and cutting somebody off at whatever time the
   * column happens to hold would be arbitrary.
   */
  private assertLicenceStillValid(profile: DriverProfile): void {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!profile.licenceExpiry) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        'LICENCE_MISSING',
        'Add your driving licence details before going on duty',
      );
    }
    if (profile.licenceExpiry < startOfToday) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        'LICENCE_EXPIRED',
        'Your driving licence has expired — register again with a current one',
      );
    }
  }

  /**
   * The partner's position, refreshed while they are on duty.
   *
   * Also the heartbeat: a partner whose app has been killed stops sending
   * these, and dispatch stops considering them without needing to be told.
   */
  async updateLocation(
    user: AuthUser,
    dto: DriverLocationDto,
  ): Promise<{ ok: true; updated: number }> {
    // Named service: the heartbeat from a partner working that product.
    // Omitted: the app has just opened and is saying where this account is,
    // for whichever products it drives for — none of them, usually, which is
    // why this reports rather than throwing.
    const profiles = dto.service
      ? [await this.assertProfile(user.id, dto.service)]
      : await this.drivers.findProfilesForUser(user.id);

    for (const profile of profiles) {
      await this.drivers.update(profile.id, {
        lat: dto.lat,
        lng: dto.lng,
        lastSeenAt: new Date(),
      });

      // While on a job, the rider's map follows the partner in real time.
      if (profile.activeBookingId) {
        this.gateway.emitDriverPosition(profile.activeBookingId, dto.lat, dto.lng);
      }

      // And when they are free and on duty, every map open over that part of
      // the city sees the marker move. The condition matches `findNearby`'s
      // where clause on purpose: a partner who would not be offered work must
      // not be drawn as if they were waiting for it.
      if (profile.isOnline && !profile.activeBookingId) {
        await this.broadcastPosition(profile, dto.lat, dto.lng);
      }
    }
    return { ok: true, updated: profiles.length };
  }

  /**
   * Puts one partner's new position on the maps watching that area.
   *
   * The payload is the same shape `GET /dispatch/nearby/*` returns, so a
   * client merges a live update into its snapshot without a second parser.
   * `distanceKm` is the one thing it cannot carry — it depends on where the
   * rider is, not where the partner is, so the client computes it if it cares.
   */
  private async broadcastPosition(profile: DriverProfile, lat: number, lng: number): Promise<void> {
    const classes = await this.vehicleClasses(profile.service);
    const known = classes.get(profile.vehicleSlug);
    this.gateway.emitVehicleMoved(profile.service, lat, lng, {
      id: profile.id,
      vehicleSlug: profile.vehicleSlug,
      emoji: known?.emoji ?? '🚗',
      lat,
      lng,
      etaMinutes: known?.etaMinutes ?? 5,
    });
  }

  // ─── what the rider's map shows ────────────────────────────────────────────

  /**
   * Vehicles near a point, as map pins.
   *
   * Returns what is really there. An empty list means nobody is on duty
   * nearby — the map shows no cars rather than invented ones, because a rider
   * who requests against a phantom waits out the full offer window for
   * nothing.
   */
  async nearbyVehicles(service: DriverService, query: NearbyQueryDto): Promise<NearbyVehicleDto[]> {
    const nearby = await this.drivers.findNearby(
      service,
      { lat: query.lat, lng: query.lng },
      DISPATCH_RADIUS_KM,
      { vehicleSlug: query.vehicleSlug },
    );
    const classes = await this.vehicleClasses(service);

    return nearby.map((d) => {
      const known = classes.get(d.vehicleSlug);
      return {
        id: d.id,
        vehicleSlug: d.vehicleSlug,
        emoji: known?.emoji ?? '🚗',
        lat: d.lat,
        lng: d.lng,
        distanceKm: d.distanceKm,
        etaMinutes: known?.etaMinutes ?? 5,
      };
    });
  }

  // ─── offering work ─────────────────────────────────────────────────────────

  /**
   * Offers a booking to the nearest free partners at once.
   *
   * Broadcast rather than one at a time: asking partners in turn, each with
   * their own countdown, is how a rider ends up waiting minutes for a car that
   * was always two streets away. Whoever accepts first gets it; the rest are
   * told it is gone.
   *
   * Returns the user ids offered, so the caller can close them out on
   * acceptance.
   */
  async offer(
    service: DriverService,
    origin: { lat: number; lng: number },
    vehicleSlug: string,
    job: Omit<JobOffer, 'service' | 'pickupDistanceKm' | 'expiresInSeconds'>,
    expiresInSeconds: number,
  ): Promise<string[]> {
    const nearby = await this.drivers.findNearby(service, origin, DISPATCH_RADIUS_KM, {
      vehicleSlug,
      limit: MAX_OFFERS_PER_REQUEST,
    });
    if (nearby.length === 0) {
      this.logger.log(`no partners near ${job.code} (${service})`);
      return [];
    }

    for (const driver of nearby) {
      this.gateway.emitOffer(driver.userId, {
        ...job,
        service,
        pickupDistanceKm: driver.distanceKm,
        expiresInSeconds,
      } satisfies JobOffer);
    }
    this.logger.log(`offered ${job.code} to ${nearby.length} partner(s)`);
    return nearby.map((d) => d.userId);
  }

  /**
   * A partner takes a job — or finds it already taken.
   *
   * The claim is a conditional UPDATE, so two partners tapping "accept" in the
   * same instant cannot both win. The loser is told plainly rather than left
   * driving towards a fare somebody else has.
   */
  async claim(user: AuthUser, service: DriverService, bookingId: string): Promise<DriverWithName> {
    const profile = await this.assertProfile(user.id, service);
    if (profile.activeBookingId) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ALREADY_ON_A_JOB',
        'Finish your current job before taking another',
      );
    }
    const claimed = await this.drivers.claim(profile.id, bookingId);
    if (!claimed) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'DRIVER_UNAVAILABLE',
        'You are no longer available for this job',
      );
    }
    return profile;
  }

  /** Frees the partner when the job ends, however it ended. */
  async release(driverId: string | null): Promise<void> {
    if (driverId) await this.drivers.release(driverId);
  }

  closeOffers(driverUserIds: string[], bookingId: string): void {
    this.gateway.emitOfferClosed(driverUserIds, bookingId);
  }

  /** The pickup code a rider reads out, proving the partner is really there. */
  pickupOtp(): string {
    return String(randomInt(10 ** PICKUP_OTP_LENGTH)).padStart(PICKUP_OTP_LENGTH, '0');
  }

  async findById(id: string): Promise<DriverProfile | null> {
    return this.drivers.findById(id);
  }

  /** This user's profile for one product, or a 404 if they do not drive it. */
  async profileFor(user: AuthUser, service: DriverService): Promise<DriverWithName> {
    return this.assertProfile(user.id, service);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertProfile(userId: string, service: DriverService): Promise<DriverWithName> {
    const profile = await this.drivers.findProfile(userId, service);
    if (!profile) {
      throw new ResourceNotFoundException('Driver profile');
    }
    return profile;
  }

  /** slug → the class's display emoji and advertised ETA. */
  private async vehicleClasses(
    service: DriverService,
  ): Promise<Map<string, { emoji: string; etaMinutes: number }>> {
    const rows =
      service === DriverService.RIDE
        ? await this.rideTypes.listActive()
        : await this.porterCatalog.listActiveVehicles();
    return new Map(rows.map((r) => [r.slug, { emoji: r.emoji, etaMinutes: r.etaMinutes }]));
  }

  private async assertVehicleClass(service: DriverService, slug: string): Promise<void> {
    const known =
      service === DriverService.RIDE
        ? await this.rideTypes.findActiveBySlug(slug)
        : await this.porterCatalog.findActiveVehicleBySlug(slug);
    if (!known) {
      throw new ResourceNotFoundException('Vehicle class');
    }
  }

  private toProfileJson(profile: DriverProfile): Record<string, unknown> {
    return {
      id: profile.id,
      service: profile.service,
      vehicleSlug: profile.vehicleSlug,
      vehicleLabel: profile.vehicleLabel,
      plateNumber: profile.plateNumber,
      // Identity, for the partner's own screen. The document keys are
      // deliberately absent: the partner has no use for them and a key is one
      // step from the file, so it stays server-side.
      fullName: profile.fullName,
      dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: profile.gender,
      licenceNumber: profile.licenceNumber,
      licenceExpiry: profile.licenceExpiry?.toISOString().slice(0, 10) ?? null,
      /// Whether the paperwork has been checked, so the app can say so.
      verification: profile.verification,
      hasDocuments: Boolean(
        profile.licenceFrontKey && profile.licenceBackKey && profile.vehicleDocKey,
      ),
      isOnline: profile.isOnline,
      lat: profile.lat === null ? null : Number(profile.lat),
      lng: profile.lng === null ? null : Number(profile.lng),
      /// The job in hand, so a partner reopening the app lands back on it.
      activeBookingId: profile.activeBookingId,
    };
  }
}
