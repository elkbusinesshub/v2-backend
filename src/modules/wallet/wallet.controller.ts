import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { WalletAmountDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly service: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Balance, reward points, and transaction history' })
  async summary(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getSummary(user);
  }

  @Post('top-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add money to the wallet' })
  async topUp(
    @CurrentUser() user: AuthUser,
    @Body() dto: WalletAmountDto,
  ): Promise<ApiResponse<{ balance: number }>> {
    const result = await this.service.topUp(user, dto);
    return ApiResponse.of(result, 'Wallet topped up');
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw money from the wallet' })
  async withdraw(
    @CurrentUser() user: AuthUser,
    @Body() dto: WalletAmountDto,
  ): Promise<ApiResponse<{ balance: number }>> {
    const result = await this.service.withdraw(user, dto);
    return ApiResponse.of(result, 'Withdrawal successful');
  }
}
