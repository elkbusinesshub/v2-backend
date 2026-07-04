import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WsResponse,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser } from '@/common/types/auth.types';
import { createWsAuthMiddleware } from './ws-auth.middleware';

/**
 * Reference gateway — the template every future realtime module copies
 * (chat, live location, notifications, presence, typing):
 *
 *   1. own namespace per domain
 *   2. JWT handshake auth via createWsAuthMiddleware
 *   3. every socket joins its user room `user:{id}` so other services can
 *      target a person across all their devices:
 *        server.to(`user:${id}`).emit(...)
 *   4. business rooms (order:{id}, ride:{id}) joined per feature
 */
@WebSocketGateway({ namespace: '/system' })
export class SystemGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(SystemGateway.name);

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
    this.logger.debug(`socket connected: user=${user.id}`);
  }

  /** Connectivity probe for clients. */
  @SubscribeMessage('ping')
  ping(): WsResponse<{ pong: boolean; ts: number }> {
    return { event: 'pong', data: { pong: true, ts: Date.now() } };
  }
}
