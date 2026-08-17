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
import { CHAT_NAMESPACE } from './chat.constants';

/** The room every one of an account's devices is in. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Realtime chat: own namespace, JWT handshake auth, one room per account.
 *
 * There is no "join this conversation" message any more. A socket is in
 * exactly one room — its own account's — and a message is delivered to the
 * recipient's room. Nobody can subscribe to somebody else's conversation
 * because there is nothing to subscribe to: authorisation is the handshake,
 * not a per-thread permission check that had to be got right every time.
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
    void client.join(userRoom(user.id));
  }

  /**
   * Delivers a message to the account it was sent to.
   *
   * [message] is already rendered from the recipient's point of view — the
   * sender has their own copy from the HTTP response, and sending them a
   * payload built for somebody else would show their own words arriving as
   * an incoming message.
   */
  emitMessage(recipientId: string, message: Record<string, unknown>): void {
    this.server.to(userRoom(recipientId)).emit('message', message);
    this.logger.debug(`chat message emitted to user=${recipientId}`);
  }

  /** Tells [recipientId] that the other side has opened the conversation. */
  emitRead(recipientId: string, payload: Record<string, unknown>): void {
    this.server.to(userRoom(recipientId)).emit('read', payload);
  }
}
