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
import { CHAT_NAMESPACE } from './orders.constants';

/** Room a booking's chat participants share, so a message reaches every device. */
export function orderRoom(bookingId: string): string {
  return `order:${bookingId}`;
}

/**
 * Realtime order chat, following the SystemGateway template: own namespace,
 * JWT handshake auth, per-user rooms. Clients additionally `join` a specific
 * order room to receive that thread's live messages. HTTP POST persists a
 * message and then calls `emitMessage` here to fan it out.
 */
@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() private server!: Namespace;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Namespace): void {
    server.use(createWsAuthMiddleware(this.jwtService));
  }

  handleConnection(client: Socket): void {
    const user = (client.data as { user?: AuthUser }).user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    void client.join(`user:${user.id}`);
  }

  /** Client subscribes to a specific order thread. */
  @SubscribeMessage('order:join')
  joinOrder(client: Socket, bookingId: unknown): void {
    if (typeof bookingId === 'string' && bookingId) {
      void client.join(orderRoom(bookingId));
    }
  }

  @SubscribeMessage('order:leave')
  leaveOrder(client: Socket, bookingId: unknown): void {
    if (typeof bookingId === 'string' && bookingId) {
      void client.leave(orderRoom(bookingId));
    }
  }

  /** Fan a persisted message out to everyone watching the order thread. */
  emitMessage(bookingId: string, message: Record<string, unknown>): void {
    this.server.to(orderRoom(bookingId)).emit('message', message);
    this.logger.debug(`chat message emitted: order=${bookingId}`);
  }
}
