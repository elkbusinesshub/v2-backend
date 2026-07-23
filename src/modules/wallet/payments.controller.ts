import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { ChargeDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: WalletService) {}

  @Get('methods')
  @ApiOperation({ summary: 'Payment method options (wallet subLabel is the live balance)' })
  async methods(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listPaymentMethods(user);
  }

  @Post('charge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Charge a payment method (wallet debits for real; others are mock)' })
  async charge(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChargeDto,
  ): Promise<ApiResponse<{ reference: string }>> {
    const result = await this.service.charge(user, dto);
    return ApiResponse.of(result, 'Payment successful');
  }
}
