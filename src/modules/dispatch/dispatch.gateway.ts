import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser } from '@/common/types/auth.types';
import { createWsAuthMiddleware } from '@/sockets/ws-auth.middleware';
import { DISPATCH_NAMESPACE } from './dispatch.constants';

/** Room a partner listens on for work offered to them. */
export function driverRoom(userId: string): string {
  return `driver:${userId}`;
}

/** Room a rider listens on for what is happening to their trip. */
export function tripRoom(bookingId: string): string {
  return `trip:${bookingId}`;
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

  /** A rider's socket subscribes to their own trip after the HTTP call. */
  joinTrip(userId: string, bookingId: string): void {
    // Every socket the rider has open, so a trip opened on one device is live
    // on the others too.
    this.server.in(`user:${userId}`).socketsJoin(tripRoom(bookingId));
  }
}
