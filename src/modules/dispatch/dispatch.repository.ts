import { Inject, Injectable } from '@nestjs/common';
import {
  DriverService,
  PorterBookingStatus,
  RideBookingStatus,
  type DriverProfile,
  type Prisma,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import { HEARTBEAT_STALE_SECONDS } from './dispatch.constants';
import { boundingBox, distanceKm } from './geo';

/** A partner's profile alongside the name shown to whoever they are serving. */
export type DriverWithName = DriverProfile & { user: { name: string | null } };

/** A partner with a known position, and how far away they are. */
export interface NearbyDriver {
  id: string;
  userId: string;
  vehicleSlug: string;
  vehicleLabel: string;
  plateNumber: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

@Injectable()
export class DispatchRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** The partner's profile, with the name a rider will see. */
  async findProfile(userId: string, service: DriverService): Promise<DriverWithName | null> {
    return this.db.driverProfile.findUnique({
      where: { userId_service: { userId, service } },
      include: { user: { select: { name: true } } },
    });
  }

  async findById(id: string): Promise<DriverProfile | null> {
    return this.db.driverProfile.findUnique({ where: { id } });
  }

  async upsertProfile(
    userId: string,
    service: DriverService,
    data: { vehicleSlug: string; vehicleLabel: string; plateNumber: string },
  ): Promise<DriverProfile> {
    return this.db.driverProfile.upsert({
      where: { userId_service: { userId, service } },
      update: data,
      create: { userId, service, ...data },
    });
  }

  async update(id: string, data: Prisma.DriverProfileUncheckedUpdateInput): Promise<DriverProfile> {
    return this.db.driverProfile.update({ where: { id }, data });
  }

  /**
   * Online partners of one class within [radiusKm] of a point, nearest first.
   *
   * Two-stage on purpose: the SQL narrows by a bounding box the index can
   * serve, and the exact circle is measured here. Filtering by true distance in
   * SQL would mean a full scan of every partner in the country.
   *
   * Excludes anyone already on a job, and anyone whose heartbeat has gone
   * quiet — an app killed mid-shift never gets to mark itself offline, and
   * dispatching to it would strand the rider.
   */
  async findNearby(
    service: DriverService,
    origin: { lat: number; lng: number },
    radiusKm: number,
    options: { vehicleSlug?: string; limit?: number } = {},
  ): Promise<NearbyDriver[]> {
    const box = boundingBox(origin, radiusKm);
    const freshSince = new Date(Date.now() - HEARTBEAT_STALE_SECONDS * 1000);

    const rows = await this.db.driverProfile.findMany({
      where: {
        service,
        isOnline: true,
        activeBookingId: null,
        lastSeenAt: { gte: freshSince },
        lat: { gte: box.minLat, lte: box.maxLat },
        lng: { gte: box.minLng, lte: box.maxLng },
        ...(options.vehicleSlug ? { vehicleSlug: options.vehicleSlug } : {}),
      },
    });

    return rows
      .flatMap((d) => {
        // The query guarantees these are set; the types cannot know it.
        if (d.lat === null || d.lng === null) return [];
        const at = { lat: Number(d.lat), lng: Number(d.lng) };
        const away = distanceKm(origin, at);
        if (away > radiusKm) return []; // a box corner, outside the circle
        return [
          {
            id: d.id,
            userId: d.userId,
            vehicleSlug: d.vehicleSlug,
            vehicleLabel: d.vehicleLabel,
            plateNumber: d.plateNumber,
            lat: at.lat,
            lng: at.lng,
            distanceKm: Math.round(away * 100) / 100,
          },
        ];
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, options.limit ?? rows.length);
  }

  /**
   * Claims a partner for a job, but only if they are still free.
   *
   * `activeBookingId: null` in the where clause is the whole point: two riders
   * whose requests reach the same partner at the same instant cannot both win,
   * because only one UPDATE will match. Returns false for the loser.
   */
  async claim(driverId: string, bookingId: string): Promise<boolean> {
    const result = await this.db.driverProfile.updateMany({
      where: { id: driverId, activeBookingId: null, isOnline: true },
      data: { activeBookingId: bookingId },
    });
    return result.count === 1;
  }

  /** Frees a partner once the job ends, however it ended. */
  async release(driverId: string): Promise<void> {
    await this.db.driverProfile.updateMany({
      where: { id: driverId },
      data: { activeBookingId: null },
    });
  }

  /**
   * Marks an unanswered request as such — but only while it is still on offer.
   *
   * Reaching into the two booking tables is deliberate: the offer window is a
   * dispatch concern, and giving dispatch a callback into rides and porter
   * would make the module graph circular for one UPDATE each.
   */
  async expireRideOffer(bookingId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id: bookingId, status: RideBookingStatus.SEARCHING },
      data: { status: RideBookingStatus.NO_DRIVERS },
    });
    return result.count === 1;
  }

  async expirePorterOffer(bookingId: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id: bookingId, status: PorterBookingStatus.SEARCHING },
      data: { status: PorterBookingStatus.NO_DRIVERS },
    });
    return result.count === 1;
  }

  /** Every service a user drives for — the panel shows one card per profile. */
  async findProfilesForUser(userId: string): Promise<DriverProfile[]> {
    return this.db.driverProfile.findMany({ where: { userId }, orderBy: { service: 'asc' } });
  }
}

export { DriverService };
