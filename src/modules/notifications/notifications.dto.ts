import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
