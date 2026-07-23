import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateOfferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  tagLabel!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  expiryLabel!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  discountLabel!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  discountSubLabel!: string;

  @ApiProperty({ example: 0xff0d3d35, description: 'ARGB gradient start' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  gradientStartHex!: number;

  @ApiProperty({ example: 0xff4bbfb0, description: 'ARGB gradient end' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  gradientEndHex!: number;
}
