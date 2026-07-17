import { IsNotEmpty, IsString, Matches } from 'class-validator';

const E164_PHONE = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  /** E.164 format, e.g. +14155552671 */
  @Matches(E164_PHONE, { message: 'phone must be in E.164 format, e.g. +14155552671' })
  phone!: string;
}

export class VerifyOtpDto {
  @Matches(E164_PHONE, { message: 'phone must be in E.164 format, e.g. +14155552671' })
  phone!: string;

  @Matches(/^\d{4}$/, { message: 'otp must be a 4-digit code' })
  otp!: string;
}

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
