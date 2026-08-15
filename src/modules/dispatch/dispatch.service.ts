import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DriverService, type DriverProfile } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { PorterCatalogRepository } from '@/modules/porter/porter-catalog.repository';
import { RideTypesRepository } from '@/modules/rides/ride-types.repository';
import {
  DISPATCH_RADIUS_KM,
  MAX_OFFERS_PER_REQUEST,
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
   * Registers, or updates, the vehicle a partner runs.
   *
   * The class is checked against the live catalogue rather than trusted: a
   * partner registered under a slug no dispatch will ever search for would sit
   * online forever and never be offered anything.
   */
  async register(user: AuthUser, dto: RegisterDriverDto): Promise<Record<string, unknown>> {
    await this.assertVehicleClass(dto.service, dto.vehicleSlug);
    const profile = await this.drivers.upsertProfile(user.id, dto.service, {
      vehicleSlug: dto.vehicleSlug,
      vehicleLabel: dto.vehicleLabel,
      plateNumber: dto.plateNumber.toUpperCase(),
    });
    this.logger.log(`driver registered: user=${user.id} service=${dto.service}`);
    return this.toProfileJson(profile);
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
   */
  async setOnline(user: AuthUser, dto: SetOnlineDto): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user.id, dto.service);
    const updated = await this.drivers.update(profile.id, {
      isOnline: dto.isOnline,
      // A fix taken as they go on duty makes them dispatchable immediately,
      // rather than only after the first heartbeat lands.
      ...(dto.lat !== undefined && dto.lng !== undefined
        ? { lat: dto.lat, lng: dto.lng, lastSeenAt: new Date() }
        : {}),
    });
    return this.toProfileJson(updated);
  }

  /**
   * The partner's position, refreshed while they are on duty.
   *
   * Also the heartbeat: a partner whose app has been killed stops sending
   * these, and dispatch stops considering them without needing to be told.
   */
  async updateLocation(user: AuthUser, dto: DriverLocationDto): Promise<{ ok: true }> {
    const profile = await this.assertProfile(user.id, dto.service);
    await this.drivers.update(profile.id, {
      lat: dto.lat,
      lng: dto.lng,
      lastSeenAt: new Date(),
    });

    // While on a job, the rider's map follows the partner in real time.
    if (profile.activeBookingId) {
      this.gateway.emitDriverPosition(profile.activeBookingId, dto.lat, dto.lng);
    }
    return { ok: true };
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
      isOnline: profile.isOnline,
      lat: profile.lat === null ? null : Number(profile.lat),
      lng: profile.lng === null ? null : Number(profile.lng),
      /// The job in hand, so a partner reopening the app lands back on it.
      activeBookingId: profile.activeBookingId,
    };
  }
}
