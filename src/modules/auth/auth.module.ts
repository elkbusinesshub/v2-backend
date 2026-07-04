import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import type { AppConfig } from '@/config/configuration';
import { UsersModule } from '@/modules/users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshSessionRepository } from './refresh-session.repository';
import { TokenDenylistService } from './token-denylist.service';

/**
 * Authentication foundation. Registers the global guards:
 * JwtAuthGuard first, RolesGuard second (provider order = execution order),
 * so every new route is authenticated by default — opting OUT requires an
 * explicit @Public().
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true, // JwtService available app-wide (guards, socket auth)
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt.accessSecret', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    RefreshSessionRepository,
    TokenDenylistService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, PasswordService, TokenDenylistService],
})
export class AuthModule {}
