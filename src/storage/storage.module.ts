import { Global, Module } from '@nestjs/common';
import { S3StorageProvider } from './s3.storage';
import { STORAGE_PROVIDER } from './storage.interface';

/**
 * Binds the StorageProvider port to its S3 adapter. To replace S3:
 * implement StorageProvider once and change `useClass` here.
 */
@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: S3StorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
