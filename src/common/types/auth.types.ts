import { Role } from '@prisma/client';

/** Claims carried inside a signed access token. */
export interface AccessTokenPayload {
  /** user id */
  sub: string;
  roles: Role[];
  /** unique token id — used for the logout denylist */
  jti: string;
  type: 'access';
  iat: number;
  exp: number;
}

/** Attached to req.user / socket.data.user by the auth guard/middleware. */
export interface AuthUser {
  id: string;
  roles: Role[];
  jti: string;
  /** access-token expiry (epoch seconds) — needed to TTL the denylist entry */
  exp: number;
}
