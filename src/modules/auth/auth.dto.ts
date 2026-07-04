import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  /** The opaque refresh token returned at login/refresh */
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  /** Refresh token of the session to terminate */
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class TokenPairDto {
  accessToken!: string;
  refreshToken!: string;
  tokenType!: 'Bearer';
  /** access-token lifetime in seconds */
  expiresIn!: number;
}
