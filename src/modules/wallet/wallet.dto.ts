import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';
import { PAYMENT_METHOD_IDS } from './wallet.constants';

export class ChargeDto {
  @ApiProperty({ enum: PAYMENT_METHOD_IDS })
  @IsIn(PAYMENT_METHOD_IDS)
  methodId!: string;

  @Type(() => Number)
  @IsPositive()
  @Max(1_000_000)
  amount!: number;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  promoCode?: string;
}

export class WalletAmountDto {
  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsPositive()
  @Max(1_000_000)
  amount!: number;
}
