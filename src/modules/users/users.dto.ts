import { Role } from '@prisma/client';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** ISO 639-1 code, e.g. "en", "ar", "hi" */
  @IsOptional()
  @Matches(/^[a-z]{2}$/, { message: 'language must be a two-letter ISO 639-1 code' })
  language?: string;
}

export class ProfileDto {
  id!: string;
  phone!: string | null;
  email!: string | null;
  name!: string | null;
  language!: string;
  roles!: Role[];
}
