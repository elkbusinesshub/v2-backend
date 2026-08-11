import { Global, Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { S3StorageProvider } from './s3.storage';
import { STORAGE_PROVIDER } from './storage.interface';

/**
 * Binds the StorageProvider port to its S3 adapter. To replace S3:
 * implement StorageProvider once and change `useClass` here.
 *
 * [ImageService] sits on top for the image ingest path (validate, downscale,
 * re-encode) that the ads and provider-document uploads share.
 */
@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: S3StorageProvider }, ImageService],
  exports: [STORAGE_PROVIDER, ImageService],
})
export class StorageModule {}
