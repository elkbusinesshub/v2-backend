import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  businessName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  serviceCategory!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  contactNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  serviceArea!: string;

  @IsBoolean()
  tradeLicenseUploaded!: boolean;

  @IsBoolean()
  idDocumentUploaded!: boolean;
}

export class SetAvailabilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isAvailable!: boolean;
}

export class RespondRequestDto {
  @ApiProperty({ example: true, description: 'true = accept, false = decline' })
  @IsBoolean()
  accept!: boolean;
}

export class VerifyProviderDto {
  @ApiProperty({ enum: ['verified', 'rejected'] })
  @IsIn(['verified', 'rejected'])
  decision!: string;
}
