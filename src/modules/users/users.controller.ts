import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { ProfileDto, SelectLanguageDto, UpdateProfileDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Return the current user's profile" })
  async me(@CurrentUser() user: AuthUser): Promise<ApiResponse<ProfileDto>> {
    return ApiResponse.of(await this.usersService.getProfile(user.id));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update name, email, or preferred language' })
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ApiResponse<ProfileDto>> {
    const profile = await this.usersService.updateProfile(user.id, dto);
    return ApiResponse.of(profile, 'Profile updated');
  }

  @Patch('me/language')
  @ApiOperation({ summary: 'Set the preferred app language' })
  async selectLanguage(
    @CurrentUser() user: AuthUser,
    @Body() dto: SelectLanguageDto,
  ): Promise<ApiResponse<ProfileDto>> {
    const profile = await this.usersService.updateProfile(user.id, dto);
    return ApiResponse.of(profile, 'Language updated');
  }
}
