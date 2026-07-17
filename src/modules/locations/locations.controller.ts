import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AddressDto, CreateAddressDto, UpdateAddressDto } from './locations.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's saved addresses" })
  async list(@CurrentUser() user: AuthUser): Promise<ApiResponse<AddressDto[]>> {
    const addresses = await this.locations.list(user.id);
    return ApiResponse.of(addresses);
  }

  @Post()
  @ApiOperation({ summary: 'Save a new address (from GPS or a map pick)' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAddressDto,
  ): Promise<ApiResponse<AddressDto>> {
    const address = await this.locations.create(user.id, dto);
    return ApiResponse.of(address, 'Address saved');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename an address or set it as default' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<ApiResponse<AddressDto>> {
    const address = await this.locations.update(user.id, id, dto);
    return ApiResponse.of(address, 'Address updated');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a saved address' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ApiResponse<null>> {
    await this.locations.remove(user.id, id);
    return ApiResponse.of(null, 'Address removed');
  }
}
