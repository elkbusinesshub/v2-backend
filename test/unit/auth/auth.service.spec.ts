import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { UnauthenticatedException } from '@/common/errors/domain.exceptions';
import { AuthService } from '@/modules/auth/auth.service';
import { OtpService } from '@/modules/auth/otp.service';
import {
  RefreshSessionRepository,
  SessionWithUser,
} from '@/modules/auth/refresh-session.repository';
import { TokenDenylistService } from '@/modules/auth/token-denylist.service';
import { UsersRepository } from '@/modules/users/users.repository';

const user = {
  id: 'u-1',
  phone: '+971500000001',
  email: null,
  name: 'Test User',
  roles: [Role.USER],
  language: 'en',
  rewardPoints: 0,
  walletBalance: new Prisma.Decimal(0),
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function makeSession(overrides: Partial<SessionWithUser> = {}): SessionWithUser {
  return {
    id: 's-1',
    userId: user.id,
    tokenHash: 'hash',
    familyId: 'fam-1',
    userAgent: null,
    ip: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    replacedByTokenHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user,
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let sessions: jest.Mocked<RefreshSessionRepository>;
  let users: jest.Mocked<UsersRepository>;
  let denylist: jest.Mocked<TokenDenylistService>;
  let otp: jest.Mocked<OtpService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('signed.jwt') },
        },
        {
          provide: RefreshSessionRepository,
          useValue: {
            create: jest.fn().mockResolvedValue(undefined),
            findByTokenHash: jest.fn(),
            claim: jest.fn().mockResolvedValue(true),
            revoke: jest.fn().mockResolvedValue(undefined),
            revokeFamily: jest.fn().mockResolvedValue(undefined),
            revokeAllForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(user),
            findByPhone: jest.fn(),
            createByPhone: jest.fn(),
          },
        },
        {
          provide: TokenDenylistService,
          useValue: { revoke: jest.fn().mockResolvedValue(undefined), isRevoked: jest.fn() },
        },
        {
          provide: OtpService,
          useValue: { issue: jest.fn(), verify: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'jwt.accessTtlSeconds' ? 900 : key === 'jwt.refreshTtlDays' ? 30 : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    sessions = moduleRef.get(RefreshSessionRepository);
    users = moduleRef.get(UsersRepository);
    denylist = moduleRef.get(TokenDenylistService);
    otp = moduleRef.get(OtpService);
  });

  describe('loginWithPhone', () => {
    it('verifies the OTP and issues a token pair for an existing user', async () => {
      users.findByPhone.mockResolvedValue(user);

      const pair = await service.loginWithPhone(user.phone, '1234', {});

      expect(otp.verify).toHaveBeenCalledWith(user.phone, '1234');
      expect(users.createByPhone).not.toHaveBeenCalled();
      expect(pair.accessToken).toBe('signed.jwt');
    });

    it('creates the user on first login', async () => {
      users.findByPhone.mockResolvedValue(null);
      users.createByPhone.mockResolvedValue(user);

      const pair = await service.loginWithPhone(user.phone, '1234', {});

      expect(users.createByPhone).toHaveBeenCalledWith(user.phone);
      expect(pair.accessToken).toBe('signed.jwt');
    });

    it('propagates OTP verification failure without touching users', async () => {
      otp.verify.mockRejectedValue(new UnauthenticatedException('Invalid OTP'));

      await expect(service.loginWithPhone(user.phone, '0000', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
      expect(users.findByPhone).not.toHaveBeenCalled();
    });
  });

  describe('issueTokenPair', () => {
    it('returns a bearer pair and persists a hashed session', async () => {
      const pair = await service.issueTokenPair(user, { ip: '1.2.3.4' });

      expect(pair.accessToken).toBe('signed.jwt');
      expect(pair.tokenType).toBe('Bearer');
      expect(pair.expiresIn).toBe(900);
      expect(pair.refreshToken.length).toBeGreaterThanOrEqual(64);

      const created = sessions.create.mock.calls[0]![0];
      expect(created.userId).toBe(user.id);
      // the raw token must never be persisted
      expect(created.tokenHash).not.toBe(pair.refreshToken);
      expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('rotateRefreshToken', () => {
    it('rotates a valid token: claims old session, creates a new one in the same family', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession());

      const pair = await service.rotateRefreshToken('valid-token', {});

      expect(sessions.claim).toHaveBeenCalledWith('s-1', expect.stringMatching(/^[a-f0-9]{64}$/));
      const created = sessions.create.mock.calls[0]![0];
      expect(created.familyId).toBe('fam-1');
      expect(pair.accessToken).toBe('signed.jwt');
    });

    it('rejects an unknown token', async () => {
      sessions.findByTokenHash.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('nope', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('detects reuse of a revoked token and revokes the whole family', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession({ revokedAt: new Date() }));

      await expect(service.rotateRefreshToken('replayed', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
      expect(sessions.revokeFamily).toHaveBeenCalledWith('fam-1');
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejects an expired session', async () => {
      sessions.findByTokenHash.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotateRefreshToken('old', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
    });

    it('revokes the family when the atomic claim is lost (concurrent reuse)', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession());
      sessions.claim.mockResolvedValue(false);

      await expect(service.rotateRefreshToken('raced', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
      expect(sessions.revokeFamily).toHaveBeenCalledWith('fam-1');
    });

    it('revokes the family when the user no longer exists', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession());
      users.findById.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('ghost', {})).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
      expect(sessions.revokeFamily).toHaveBeenCalledWith('fam-1');
    });
  });

  describe('logout', () => {
    const principal = { id: user.id, roles: [Role.USER], jti: 'jti-1', exp: 9999999999 };

    it('revokes the session and denylists the access token', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession());

      await service.logout(principal, 'refresh');

      expect(sessions.revoke).toHaveBeenCalledWith('s-1');
      expect(denylist.revoke).toHaveBeenCalledWith('jti-1', principal.exp);
    });

    it("never revokes another user's session", async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession({ userId: 'someone-else' }));

      await service.logout(principal, 'stolen-refresh');

      expect(sessions.revoke).not.toHaveBeenCalled();
      expect(denylist.revoke).toHaveBeenCalled(); // own access token still dies
    });
  });
});
