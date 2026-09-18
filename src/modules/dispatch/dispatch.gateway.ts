import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser } from '@/common/types/auth.types';
import { createWsAuthMiddleware } from '@/sockets/ws-auth.middleware';
import { DriverService } from '@prisma/client';
import { AREA_CELL_DEGREES, DISPATCH_NAMESPACE } from './dispatch.constants';

/** Room a partner listens on for work offered to them. */
export function driverRoom(userId: string): string {
  return `driver:${userId}`;
}

/** Room a rider listens on for what is happening to their trip. */
export function tripRoom(bookingId: string): string {
  return `trip:${bookingId}`;
}

/** The cell a coordinate falls in, as a room name. */
export function areaRoom(service: DriverService, lat: number, lng: number): string {
  const cell = (v: number) => Math.floor(v / AREA_CELL_DEGREES);
  return `area:${service}:${cell(lat)}:${cell(lng)}`;
}

/**
 * The nine cells around a point.
 *
 * A rider subscribes to their own cell *and its neighbours*: a partner one
 * street the other side of a cell boundary is just as near as one inside it,
 * and would otherwise never appear on the map until they happened to cross
 * over. Publishing stays cheap — a partner writes to one cell, only reading
 * fans out.
 */
export function areaRoomsAround(service: DriverService, lat: number, lng: number): string[] {
  const rooms: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      rooms.push(areaRoom(service, lat + dy * AREA_CELL_DEGREES, lng + dx * AREA_CELL_DEGREES));
    }
  }
  return rooms;
}

/**
 * Realtime dispatch, following the ChatGateway template: own namespace, JWT
 * handshake auth, per-user rooms.
 *
 * Rooms are derived from the authenticated principal and the booking id, never
 * from anything the client asks to join — a partner cannot subscribe to another
 * partner's offers, and the trip room is only ever emitted to alongside a
 * database write that already checked ownership.
 */
@WebSocketGateway({ namespace: DISPATCH_NAMESPACE })
export class DispatchGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(DispatchGateway.name);

  @WebSocketServer() private server!: Namespace;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Namespace): void {
    server.use(createWsAuthMiddleware(this.jwtService));
  }

  /**
   * Every connection joins its own driver room and its own user room.
   *
   * Both are keyed by the verified principal, so there is no join event to
   * abuse: a socket receives exactly the offers and trip updates meant for the
   * account that opened it.
   */
  handleConnection(client: Socket): void {
    const user = (client.data as { user?: AuthUser }).user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    void client.join(driverRoom(user.id));
    void client.join(`user:${user.id}`);
  }

  /** Offers a job to one partner. */
  emitOffer(driverUserId: string, offer: Record<string, unknown>): void {
    this.server.to(driverRoom(driverUserId)).emit('job:offer', offer);
  }

  /**
   * Tells the partners who did not win that the job is gone.
   *
   * Without this their screens would keep counting down on work somebody else
   * is already driving to.
   */
  emitOfferClosed(driverUserIds: string[], bookingId: string): void {
    for (const id of driverUserIds) {
      this.server.to(driverRoom(id)).emit('job:closed', { bookingId });
    }
  }

  /** Tells the rider what just happened to their trip. */
  emitTrip(bookingId: string, event: string, payload: Record<string, unknown>): void {
    this.server.to(tripRoom(bookingId)).emit(event, { bookingId, ...payload });
    this.logger.debug(`dispatch ${event}: trip=${bookingId}`);
  }

  /**
   * The partner's position, to whoever is watching this trip.
   *
   * Emitted straight through rather than stored per-trip: the rider's map wants
   * where the car is now, and the profile row already holds that.
   */
  emitDriverPosition(bookingId: string, lat: number, lng: number): void {
    this.server.to(tripRoom(bookingId)).emit('driver:moved', { bookingId, lat, lng });
  }

  /**
   * A rider's map subscribes to the vehicles around a point.
   *
   * Unlike the driver and trip rooms this *is* client-chosen, and safely so:
   * an area room carries no more than the map already shows anybody who scrolls
   * there — a vehicle class and a moving dot, with no partner named. The
   * previous subscription is dropped first, so panning the map does not
   * accumulate rooms.
   */
  @SubscribeMessage('area:join')
  joinArea(client: Socket, payload: unknown): void {
    const p = payload as { service?: unknown; lat?: unknown; lng?: unknown } | null;
    const service = p?.service;
    const lat = p?.lat;
    const lng = p?.lng;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      (service !== DriverService.RIDE && service !== DriverService.PORTER)
    ) {
      client.emit('area:denied', { reason: 'bad area' });
      return;
    }

    this.leaveAreas(client);
    const rooms = areaRoomsAround(service, lat, lng);
    for (const room of rooms) void client.join(room);
    (client.data as { areas?: string[] }).areas = rooms;
    client.emit('area:joined', { service, lat, lng });
  }

  @SubscribeMessage('area:leave')
  leaveArea(client: Socket): void {
    this.leaveAreas(client);
  }

  private leaveAreas(client: Socket): void {
    const previous = (client.data as { areas?: string[] }).areas ?? [];
    for (const room of previous) void client.leave(room);
    (client.data as { areas?: string[] }).areas = [];
  }

  /**
   * A partner's new position, to whoever is watching that part of the map.
   *
   * Published into the one cell they are standing in. Riders subscribe to the
   * nine around them, so this reaches exactly the maps it belongs on.
   */
  emitVehicleMoved(
    service: DriverService,
    lat: number,
    lng: number,
    vehicle: Record<string, unknown>,
  ): void {
    this.server.to(areaRoom(service, lat, lng)).emit('vehicle:moved', vehicle);
  }

  /**
   * A partner has stopped being available there.
   *
   * Sent when they go off duty, so a marker disappears at once instead of
   * waiting for the rider's map to time it out.
   */
  emitVehicleGone(service: DriverService, lat: number, lng: number, id: string): void {
    this.server.to(areaRoom(service, lat, lng)).emit('vehicle:gone', { id });
  }

  /** A rider's socket subscribes to their own trip after the HTTP call. */
  joinTrip(userId: string, bookingId: string): void {
    // Every socket the rider has open, so a trip opened on one device is live
    // on the others too.
    this.server.in(`user:${userId}`).socketsJoin(tripRoom(bookingId));
  }
}
