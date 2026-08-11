import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '@/common/http/api-response';
import {
  ImageService,
  MAX_UPLOAD_BYTES,
  type StoredImage,
  type UploadedFileLike,
} from '@/storage/image.service';
import { UploadImageDto } from './uploads.dto';

/**
 * Shared image ingest. Ads and provider documents both post here and then
 * persist the returned `key` against their own record, so neither module
 * needs to know about S3.
 */
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly images: ImageService) {}

  @Post('image')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image (downscaled and re-encoded server-side)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: ['ads', 'provider-docs', 'avatars'] },
      },
    },
  })
  // The size cap is enforced twice: multer rejects oversized streams before
  // they are buffered, ImageService re-checks the buffer it actually received.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadImage(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadImageDto,
  ): Promise<ApiResponse<StoredImage>> {
    const stored = await this.images.storeImage(file as UploadedFileLike, dto.purpose);
    return ApiResponse.of(stored, 'Image uploaded');
  }
}
