import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SUPPORTED_LANGUAGES } from './config.constants';

@ApiTags('config')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  @Get('languages')
  @ApiOperation({ summary: 'Supported app languages' })
  languages(): readonly (typeof SUPPORTED_LANGUAGES)[number][] {
    return SUPPORTED_LANGUAGES;
  }
}
