import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, Role } from '@prisma/client';
import { UnauthenticatedException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { toRoles } from '@/common/utils/roles';
import type { AppConfig } from '@/config/configuration';
import { UsersRepository } from '@/modules/users/users.repository';
import type { TokenPairDto } from './auth.dto';
import { OtpService } from './otp.service';
import { RefreshSessionRepository } from './refresh-session.repository';
import { TokenDenylistService } from './token-denylist.service';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Token lifecycle:
 *  - Access tokens: short-lived JWTs; revocable early via the Redis denylist.
 *  - Refresh tokens: opaque 384-bit random strings, stored only as SHA-256
 *    hashes, one DB row per session, rotated on every use.
 *  - Reuse detection: a refresh token that is already revoked (or loses the
 *    atomic claim race) proves the token was used twice — the whole session
 *    family is revoked, forcing re-login on every device in that chain.
 *
 * `issueTokenPair` is the seam login flows call after they establish the
 * user's identity — currently just phone/OTP (`loginWithPhone`).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly sessions: RefreshSessionRepository,
    private readonly users: UsersRepository,
    private readonly denylist: TokenDenylistService,
    private readonly otp: OtpService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.accessTtlSeconds = config.get('jwt.accessTtlSeconds', { infer: true });
    this.refreshTtlDays = config.get('jwt.refreshTtlDays', { infer: true });
  }

  /** Sends (logs, for now) an OTP to [phone]. Returns the resend cooldown in seconds. */
  async requestOtp(phone: string): Promise<number> {
    return this.otp.issue(phone);
  }

  /** Verifies the OTP, finding or creating the user, then issues a token pair. */
  async loginWithPhone(phone: string, code: string, meta: SessionMeta): Promise<TokenPairDto> {
    await this.otp.verify(phone, code);
    const user = (await this.users.findByPhone(phone)) ?? (await this.users.createByPhone(phone));
    return this.issueTokenPair(user, meta);
  }

  async issueTokenPair(
    user: { id: string; roles: Prisma.JsonValue },
    meta: SessionMeta,
    familyId: string = randomUUID(),
  ): Promise<TokenPairDto> {
    const refreshToken = this.generateRefreshToken();

    await this.sessions.create({
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      familyId,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + this.refreshTtlDays * DAY_MS),
    });

    return {
      accessToken: await this.signAccessToken(user.id, toRoles(user.roles)),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  async rotateRefreshToken(refreshToken: string, meta: SessionMeta): Promise<TokenPairDto> {
    const session = await this.sessions.findByTokenHash(this.hashToken(refreshToken));
    if (!session) {
      throw new UnauthenticatedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      // Token replay after rotation ⇒ theft indicator. Kill the whole chain.
      this.logger.warn(
        { userId: session.userId, familyId: session.familyId },
        'Refresh token reuse detected — revoking session family',
      );
      await this.sessions.revokeFamily(session.familyId);
      throw new UnauthenticatedException('Invalid refresh token');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthenticatedException('Refresh token expired');
    }

    const user = await this.users.findById(session.userId);
    if (!user) {
      await this.sessions.revokeFamily(session.familyId);
      throw new UnauthenticatedException('Invalid refresh token');
    }

    const newRefreshToken = this.generateRefreshToken();
    const claimed = await this.sessions.claim(session.id, this.hashToken(newRefreshToken));
    if (!claimed) {
      // Lost a race against a concurrent use of the same token ⇒ reuse.
      await this.sessions.revokeFamily(session.familyId);
      throw new UnauthenticatedException('Invalid refresh token');
    }

    await this.sessions.create({
      userId: user.id,
      tokenHash: this.hashToken(newRefreshToken),
      familyId: session.familyId,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + this.refreshTtlDays * DAY_MS),
    });

    return {
      accessToken: await this.signAccessToken(user.id, toRoles(user.roles)),
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  /** Terminates one session and immediately invalidates the current access token. */
  async logout(user: AuthUser, refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(this.hashToken(refreshToken));
    // Only the session owner may revoke it
    if (session && session.userId === user.id) {
      await this.sessions.revoke(session.id);
    }
    await this.denylist.revoke(user.jti, user.exp);
  }

  private async signAccessToken(userId: string, roles: Role[]): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, roles, jti: randomUUID(), type: 'access' },
      { expiresIn: this.accessTtlSeconds },
    );
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
