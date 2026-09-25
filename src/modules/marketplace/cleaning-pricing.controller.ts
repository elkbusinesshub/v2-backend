import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import { CLEANING_SUB_CATEGORIES } from './ad-attributes';
import { CleaningPricingService } from './cleaning-pricing.service';
import { CleaningPriceDto, UpdateCleaningPriceDto } from './marketplace.dto';

/** Only the tiles the app draws can be priced — a stray slug would never be shown. */
const SUB_CATEGORY_ENUM = Object.fromEntries(CLEANING_SUB_CATEGORIES.map((s) => [s, s]));

@ApiTags('cleaning')
@ApiBearerAuth()
@Controller('cleaning/pricing')
export class CleaningPricingController {
  constructor(private readonly service: CleaningPricingService) {}

  @Get()
  @ApiOperation({ summary: 'Hourly rate and materials fee per cleaning tile' })
  async list(): Promise<CleaningPriceDto[]> {
    return this.service.list();
  }

  @Put(':subCategory')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Set the price of one cleaning tile (admin)' })
  async update(
    @Param('subCategory', new ParseEnumPipe(SUB_CATEGORY_ENUM)) subCategory: string,
    @Body() dto: UpdateCleaningPriceDto,
  ): Promise<ApiResponse<CleaningPriceDto>> {
    return ApiResponse.of(await this.service.update(subCategory, dto), 'Price updated');
  }
}
