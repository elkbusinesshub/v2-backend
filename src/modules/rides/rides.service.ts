import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RideBookingStatus } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import {
  RIDE_CODE_ALPHABET,
  RIDE_CODE_LENGTH,
  RIDE_DEFAULT_DISTANCE_KM,
  RIDE_DEFAULT_ESTIMATE,
  RIDE_DEFAULT_ETA_MINUTES,
} from './rides.constants';
import type {
  CreateRideBookingDto,
  RateRideDto,
  RideRequestPreviewDto,
  StartRideDto,
} from './rides.dto';
import { toRideBookingJson, toRideTypeJson } from './rides.mapper';
import { RideBookingsRepository } from './ride-bookings.repository';
import { RideTypesRepository } from './ride-types.repository';
import { DriverService } from '@prisma/client';
import { DispatchService } from '@/modules/dispatch/dispatch.service';
import { DispatchGateway } from '@/modules/dispatch/dispatch.gateway';
import { DispatchScheduler } from '@/modules/dispatch/dispatch.queue';
import { OFFER_WINDOW_SECONDS } from '@/modules/dispatch/dispatch.constants';

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  /**
   * Who a trip was offered to, so the losers can be told once it is taken.
   *
   * In memory because it matters for seconds and only to the instance that
   * made the offer; a stale entry costs nothing but a socket event nobody is
   * listening for.
   */
  private readonly offered = new Map<string, string[]>();

  constructor(
    private readonly rideTypes: RideTypesRepository,
    private readonly bookings: RideBookingsRepository,
    private readonly locations: LocationsRepository,
    private readonly dispatch: DispatchService,
    private readonly gateway: DispatchGateway,
    private readonly scheduler: DispatchScheduler,
  ) {}

  // ─── legacy contract (the exact endpoints RideRepository already calls) ─────

  async listRideTypes(): Promise<Record<string, unknown>[]> {
    return (await this.rideTypes.listActive()).map(toRideTypeJson);
  }

  /** Static route estimate until the maps layer computes real distances. */
  getCurrentEstimate(): Record<string, unknown> {
    return {
      ...RIDE_DEFAULT_ESTIMATE,
      etaMinutes: RIDE_DEFAULT_ETA_MINUTES,
      distanceKm: RIDE_DEFAULT_DISTANCE_KM,
    };
  }

  /** Driver-match preview — no booking is created (matches the legacy find-drivers UX). */
  async previewDriverMatch(dto: RideRequestPreviewDto): Promise<Record<string, unknown>> {
    const rideType = await this.rideTypes.findActiveBySlug(dto.rideTypeId);
    if (!rideType) {
      throw new ValidationFailedException([{ field: 'rideTypeId', message: 'Unknown ride type' }]);
    }
    // No driver is named here any more: who comes is decided by whoever
    // accepts the request, and inventing one would be a promise the dispatch
    // cannot keep. The screen shows how long a car of this class takes.
    return { etaMinutes: rideType.etaMinutes };
  }

  // ─── bookings (the full flow behind ride_booking_flow.dart) ─────────────────

  async createBooking(user: AuthUser, dto: CreateRideBookingDto): Promise<Record<string, unknown>> {
    const rideType = await this.rideTypes.findActiveBySlug(dto.rideTypeId);
    if (!rideType) {
      throw new ValidationFailedException([{ field: 'rideTypeId', message: 'Unknown ride type' }]);
    }
    const [pickup, drop] = await Promise.all([
      this.resolvePlace(user, dto.pickupAddressId, dto.pickupAddress, dto.pickupLat, dto.pickupLng),
      this.resolvePlace(user, dto.dropAddressId, dto.dropAddress),
    ]);
    const code = await this.generateCode();

    // Created SEARCHING with no driver: who takes it is decided by whoever
    // accepts first, not by the server picking a name out of a list.
    const booking = await this.bookings.create({
      code,
      userId: user.id,
      rideTypeId: rideType.id,
      status: RideBookingStatus.SEARCHING,
      pickupAddress: pickup.address,
      dropAddress: drop.address,
      distanceKm: RIDE_DEFAULT_DISTANCE_KM,
      etaMinutes: rideType.etaMinutes,
      fare: Number(rideType.baseFare),
      cancellationFee: Number(rideType.cancellationFee),
      paymentMethod: dto.paymentMethod,
      // internal mock charge — replaced by the payments module later
      paymentRef: `PAY-${code}`,
      paidAt: new Date(),
    });

    // The rider's socket follows this trip from here on.
    this.gateway.joinTrip(user.id, booking.id);

    if (pickup.lat === null || pickup.lng === null) {
      // Nothing to search around. Better an immediate, honest answer than a
      // rider watching a spinner that could never resolve.
      await this.bookings.markNoDrivers(booking.id);
      this.logger.warn(`ride ${code} has no pickup coordinate — cannot dispatch`);
      return toRideBookingJson((await this.bookings.findById(booking.id))!);
    }

    const offered = await this.dispatch.offer(
      DriverService.RIDE,
      { lat: pickup.lat, lng: pickup.lng },
      rideType.slug,
      {
        bookingId: booking.id,
        code,
        pickupAddress: pickup.address,
        dropAddress: drop.address,
        fare: Number(rideType.baseFare),
        distanceKm: RIDE_DEFAULT_DISTANCE_KM,
      },
      OFFER_WINDOW_SECONDS,
    );
    this.offered.set(booking.id, offered);
    await this.scheduler.scheduleExpiry(booking.id, DriverService.RIDE);

    this.logger.log(`ride ${code} searching: offered to ${offered.length} partner(s)`);
    return toRideBookingJson((await this.bookings.findById(booking.id))!);
  }

  /**
   * A partner takes the trip. First one through wins; the rest are told.
   *
   * The claim on the partner and the claim on the booking are both conditional
   * updates, so neither a second partner nor a second tap can double-assign.
   */
  async acceptRide(user: AuthUser, bookingId: string): Promise<Record<string, unknown>> {
    const requested = await this.bookings.findById(bookingId);
    if (!requested) {
      throw new ResourceNotFoundException('Booking');
    }
    if (requested.userId === user.id) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'CANNOT_DRIVE_YOURSELF',
        'You cannot accept your own trip',
      );
    }
    const driver = await this.dispatch.claim(user, DriverService.RIDE, bookingId);

    const assigned = await this.bookings.assignDriver(bookingId, {
      driverId: driver.id,
      driverName: driver.user.name ?? 'ELK partner',
      vehicleLabel: driver.vehicleLabel,
      plateNumber: driver.plateNumber,
      otpCode: this.dispatch.pickupOtp(),
    });
    if (!assigned) {
      // Somebody else got there first — hand the partner back to the pool.
      await this.dispatch.release(driver.id);
      throw new DomainException(
        HttpStatus.CONFLICT,
        'RIDE_ALREADY_TAKEN',
        'Another partner accepted this trip first',
      );
    }
    const booking = await this.bookings.findById(bookingId);
    this.gateway.emitTrip(bookingId, 'trip:accepted', {
      driverName: booking!.driverName,
      vehicleLabel: booking!.vehicleLabel,
      plateNumber: booking!.plateNumber,
      otpCode: booking!.otpCode,
      etaMinutes: booking!.etaMinutes,
    });
    this.dispatch.closeOffers(this.offered.get(bookingId) ?? [], bookingId);
    this.offered.delete(bookingId);

    this.logger.log(`ride ${booking!.code} accepted by driver=${driver.id}`);
    return toRideBookingJson(booking!);
  }

  async listBookings(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.bookings.listForUser(user.id)).map(toRideBookingJson);
  }

  async getBooking(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertOwnedBooking(user, id);
    return toRideBookingJson(booking);
  }

  /** "Driver Arrived · Start Trip" — the rider confirms the OTP shown to the driver. */
  async startRide(user: AuthUser, id: string, dto: StartRideDto): Promise<Record<string, unknown>> {
    const booking = await this.assertOwnedBooking(user, id);
    if (booking.otpCode !== dto.otpCode) {
      throw new ValidationFailedException([{ field: 'otpCode', message: 'Incorrect OTP' }]);
    }
    const ok = await this.bookings.start(id, user.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'The trip can only be started from a confirmed booking',
      );
    }
    this.logger.log(`ride started: ${booking.code}`);
    return toRideBookingJson(await this.assertOwnedBooking(user, id));
  }

  /** "Complete Trip" — the rider ends the trip once arrived. */
  async completeRide(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertOwnedBooking(user, id);
    const ok = await this.bookings.complete(id, user.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'The trip can only be completed once in progress',
      );
    }
    await this.dispatch.release(booking.driverId);
    this.gateway.emitTrip(id, 'trip:completed', {});
    this.logger.log(`ride completed: ${booking.code}`);
    return toRideBookingJson(await this.assertOwnedBooking(user, id));
  }

  // ─── the partner's side of the trip ────────────────────────────────────────

  /** The trip this partner is working, if any — what their app opens onto. */
  async driverActiveTrip(user: AuthUser): Promise<Record<string, unknown> | null> {
    const profile = await this.dispatch.profileFor(user, DriverService.RIDE);
    const booking = await this.bookings.findForDriver(profile.id);
    return booking ? toRideBookingJson(booking) : null;
  }

  /**
   * The partner starts the trip with the code the rider shows them.
   *
   * Checked against the partner rather than the rider: the point of the code
   * is to prove the partner is really standing there, which only means
   * something if they are the one who has to produce it.
   */
  async driverStart(user: AuthUser, id: string, otpCode: string): Promise<Record<string, unknown>> {
    const profile = await this.dispatch.profileFor(user, DriverService.RIDE);
    const booking = await this.assertDriverBooking(profile.id, id);
    if (booking.otpCode !== otpCode) {
      throw new ValidationFailedException([{ field: 'otpCode', message: 'Incorrect OTP' }]);
    }
    const ok = await this.bookings.startByDriver(id, profile.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'The trip can only be started once the rider has been picked up',
      );
    }
    this.gateway.emitTrip(id, 'trip:started', {});
    this.logger.log(`ride started by partner: ${booking.code}`);
    return toRideBookingJson((await this.bookings.findById(id))!);
  }

  /** The partner ends the trip, and becomes available again. */
  async driverComplete(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const profile = await this.dispatch.profileFor(user, DriverService.RIDE);
    const booking = await this.assertDriverBooking(profile.id, id);
    const ok = await this.bookings.completeByDriver(id, profile.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'The trip can only be completed once it is under way',
      );
    }
    await this.dispatch.release(profile.id);
    this.gateway.emitTrip(id, 'trip:completed', {});
    this.logger.log(`ride completed by partner: ${booking.code}`);
    return toRideBookingJson((await this.bookings.findById(id))!);
  }

  /** Free cancellation — only while CONFIRMED (before the trip starts). */
  async cancelBooking(user: AuthUser, id: string): Promise<void> {
    const booking = await this.assertOwnedBooking(user, id);
    const cancelled = await this.bookings.cancel(id, user.id);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        'Rides can only be cancelled before the trip starts',
      );
    }
    // Whoever was driving to them is free again, and the rider's screen is
    // told rather than left on a countdown.
    await this.dispatch.release(booking.driverId);
    this.gateway.emitTrip(id, 'trip:cancelled', {});
    this.logger.log(`ride cancelled: ${booking.code}`);
  }

  /** Post-trip rating + optional tip — once, only after COMPLETED. */
  async rateRide(user: AuthUser, id: string, dto: RateRideDto): Promise<Record<string, unknown>> {
    await this.assertOwnedBooking(user, id);
    const ok = await this.bookings.rate(id, user.id, dto.stars, dto.tip ?? 0);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ALREADY_RATED',
        'This ride was already rated, or has not been completed yet',
      );
    }
    return toRideBookingJson(await this.assertOwnedBooking(user, id));
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertOwnedBooking(user: AuthUser, id: string) {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    return booking;
  }

  /**
   * A saved address (looked up scoped to the caller — a mismatched owner
   * behaves like "not found") takes priority over freeform text, which
   * covers the map-pick / current-location picker options that have no
   * saved address id.
   */
  private async resolvePlace(
    user: AuthUser,
    addressId: string | undefined,
    freeText: string | undefined,
    lat?: number,
    lng?: number,
  ): Promise<{ address: string; lat: number | null; lng: number | null }> {
    if (!addressId) {
      // A map pick or the current-location option carries its own fix; a
      // hand-typed line carries none, and cannot be dispatched around.
      return { address: freeText!, lat: lat ?? null, lng: lng ?? null };
    }
    const address = await this.locations.findByIdForUser(addressId, user.id);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }
    // A saved address was resolved on a map when it was saved, so it always
    // has a coordinate — better than whatever the client sends alongside it.
    return { address: address.formattedAddress, lat: address.lat, lng: address.lng };
  }

  /** The trip must be this partner's, or it reads as missing. */
  private async assertDriverBooking(driverId: string, id: string) {
    const booking = await this.bookings.findById(id);
    if (!booking || booking.driverId !== driverId) {
      throw new ResourceNotFoundException('Booking');
    }
    return booking;
  }

  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let suffix = '';
      for (let i = 0; i < RIDE_CODE_LENGTH; i++) {
        suffix += RIDE_CODE_ALPHABET[randomInt(RIDE_CODE_ALPHABET.length)];
      }
      const code = `ELK-${suffix}`;
      if (!(await this.bookings.codeExists(code))) {
        return code;
      }
    }
    return `ELK-${Date.now()}`;
  }
}
