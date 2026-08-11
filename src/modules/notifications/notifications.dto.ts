import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Internal/ops creation — not called by the app; other modules or admins raise notifications this way. */
export class CreateNotificationDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  icon!: string;

  @ApiProperty({ example: 0xffe0f7f5, description: 'ARGB tile background' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  colorHex!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  message!: string;
}

/** Registers this install's FCM token so the user's notifications reach the device. */
export class RegisterDeviceDto {
  /**
   * FCM registration token. 255 is the column width — real tokens are ~160
   * characters, so this rejects junk without ever truncating a valid one.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}

/** Releases a token on sign-out, so the next user of the phone gets no stale pushes. */
export class UnregisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;
}
