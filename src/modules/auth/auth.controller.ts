import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { LogoutDto, RefreshTokenDto, TokenPairDto } from './auth.dto';
import { AuthService, SessionMeta } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Exchange a refresh token for a new token pair (rotation). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // stricter than the global limit
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token into a new token pair' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<ApiResponse<TokenPairDto>> {
    const pair = await this.authService.rotateRefreshToken(dto.refreshToken, sessionMeta(req));
    return ApiResponse.of(pair, 'Token refreshed');
  }

  /** Terminate the current session. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the session and current access token' })
  async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto): Promise<ApiResponse<null>> {
    await this.authService.logout(user, dto.refreshToken);
    return ApiResponse.of(null, 'Logged out');
  }

  /** Who am I — demonstrates the guard + @CurrentUser wiring. */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated principal' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}

function sessionMeta(req: Request): SessionMeta {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
}
