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
  RIDE_MOCK_DRIVERS,
  RIDE_OTP_LENGTH,
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

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly rideTypes: RideTypesRepository,
    private readonly bookings: RideBookingsRepository,
    private readonly locations: LocationsRepository,
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
    const driver = this.assignDriver();
    return {
      driverName: driver.name,
      vehicle: driver.vehicleLabel,
      plateNumber: driver.plate,
      etaMinutes: rideType.etaMinutes,
    };
  }

  // ─── bookings (the full flow behind ride_booking_flow.dart) ─────────────────

  async createBooking(user: AuthUser, dto: CreateRideBookingDto): Promise<Record<string, unknown>> {
    const rideType = await this.rideTypes.findActiveBySlug(dto.rideTypeId);
    if (!rideType) {
      throw new ValidationFailedException([{ field: 'rideTypeId', message: 'Unknown ride type' }]);
    }
    const [pickupAddress, dropAddress] = await Promise.all([
      this.resolveAddress(user, dto.pickupAddressId, dto.pickupAddress),
      this.resolveAddress(user, dto.dropAddressId, dto.dropAddress),
    ]);
    const driver = this.assignDriver();
    const code = await this.generateCode();

    const booking = await this.bookings.create({
      code,
      userId: user.id,
      rideTypeId: rideType.id,
      status: RideBookingStatus.CONFIRMED,
      pickupAddress,
      dropAddress,
      distanceKm: RIDE_DEFAULT_DISTANCE_KM,
      etaMinutes: rideType.etaMinutes,
      driverName: driver.name,
      vehicleLabel: driver.vehicleLabel,
      plateNumber: driver.plate,
      otpCode: this.generateOtp(),
      fare: Number(rideType.baseFare),
      cancellationFee: Number(rideType.cancellationFee),
      paymentMethod: dto.paymentMethod,
      // internal mock charge — replaced by the payments module later
      paymentRef: `PAY-${code}`,
      paidAt: new Date(),
    });

    this.logger.log(`ride booking created: ${code} user=${user.id} rideType=${rideType.slug}`);
    return toRideBookingJson(booking);
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
    this.logger.log(`ride completed: ${booking.code}`);
    return toRideBookingJson(await this.assertOwnedBooking(user, id));
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
  private async resolveAddress(
    user: AuthUser,
    addressId: string | undefined,
    freeText: string | undefined,
  ): Promise<string> {
    if (!addressId) {
      return freeText!;
    }
    const address = await this.locations.findByIdForUser(addressId, user.id);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }
    return address.formattedAddress;
  }

  private assignDriver(): { name: string; vehicleLabel: string; plate: string } {
    return RIDE_MOCK_DRIVERS[randomInt(RIDE_MOCK_DRIVERS.length)]!;
  }

  private generateOtp(): string {
    return String(randomInt(10 ** RIDE_OTP_LENGTH)).padStart(RIDE_OTP_LENGTH, '0');
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
