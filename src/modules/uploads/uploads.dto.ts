import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** Key prefixes callers may store under — keeps the bucket navigable and
 *  stops a client choosing an arbitrary path. */
export const UPLOAD_PURPOSES = ['ads', 'provider-docs', 'avatars'] as const;

export class UploadImageDto {
  @ApiProperty({ enum: UPLOAD_PURPOSES, default: 'ads' })
  @IsOptional()
  @IsIn([...UPLOAD_PURPOSES])
  purpose: (typeof UPLOAD_PURPOSES)[number] = 'ads';
}
