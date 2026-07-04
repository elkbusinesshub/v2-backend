import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UnauthenticatedException } from '../errors/domain.exceptions';
import type { AccessTokenPayload } from '../types/auth.types';
import { TokenDenylistService } from '@/modules/auth/token-denylist.service';

/**
 * Global authentication guard (registered as APP_GUARD in AuthModule).
 * Every route requires a valid Bearer access token unless marked @Public().
 * Revoked tokens (logout / compromise) are rejected via the Redis denylist.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly denylist: TokenDenylistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    if (context.getType() !== 'http') {
      // WS handshakes authenticate in the socket middleware, not here
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthenticatedException('Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthenticatedException('Invalid or expired access token');
    }
    if (payload.type !== 'access') {
      throw new UnauthenticatedException('Invalid token type');
    }
    if (await this.denylist.isRevoked(payload.jti)) {
      throw new UnauthenticatedException('Token has been revoked');
    }

    request.user = {
      id: payload.sub,
      roles: payload.roles,
      jti: payload.jti,
      exp: payload.exp,
    };
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
