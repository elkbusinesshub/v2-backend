import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { AccessTokenPayload, AuthUser } from '@/common/types/auth.types';

/**
 * Handshake authentication for every namespace. The Flutter client connects:
 *
 *   io('$baseUrl/system', auth: { token: accessToken })
 *
 * Unauthenticated sockets are refused before any event handler runs. The
 * verified principal lives in socket.data.user.
 */
export function createWsAuthMiddleware(jwtService: JwtService) {
  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    try {
      const token =
        (socket.handshake.auth as Record<string, unknown> | undefined)?.token ??
        bearerFromHeader(socket.handshake.headers.authorization);
      if (typeof token !== 'string' || !token) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }
      const payload = await jwtService.verifyAsync<AccessTokenPayload>(token);
      if (payload.type !== 'access') {
        next(new Error('UNAUTHENTICATED'));
        return;
      }
      const user: AuthUser = {
        id: payload.sub,
        roles: payload.roles,
        jti: payload.jti,
        exp: payload.exp,
      };
      (socket.data as { user?: AuthUser }).user = user;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  };
}

function bearerFromHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
