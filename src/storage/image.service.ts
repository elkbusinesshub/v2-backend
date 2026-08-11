import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { ValidationFailedException } from '@/common/errors/domain.exceptions';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.interface';

/**
 * Compression settings ported verbatim from the legacy backend
 * (`backend-elk/helpers/utils.js`), so images keep the same dimensions and
 * weight as those already in the bucket.
 */
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
const JPEG_QUALITY = 75;
const PNG_COMPRESSION_LEVEL = 8;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface StoredImage {
  key: string;
  url: string;
  bytes: number;
}

export interface UploadedFileLike {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Image ingest: validate → downscale → re-encode → store.
 *
 * The API accepts the bytes rather than handing out a presigned PUT because
 * compression has to happen somewhere the client cannot skip — an unresized
 * phone photo is several megabytes, and the legacy bucket is full of 800×600
 * originals we want to stay consistent with.
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  /**
   * Processes and stores [file] under [prefix] (e.g. `ads`, `provider-docs`).
   * Returns the stored key plus a presigned URL for immediate display.
   */
  async storeImage(file: UploadedFileLike, prefix: string): Promise<StoredImage> {
    this.assertAcceptable(file);

    const { buffer, contentType, extension } = await this.compress(file);
    const key = `${prefix}/${new Date().getFullYear()}/${randomUUID()}${extension}`;

    await this.storage.upload({ key, body: buffer, contentType });
    this.logger.log(`stored ${key} (${file.size} -> ${buffer.length} bytes)`);

    return { key, url: await this.storage.getSignedDownloadUrl(key), bytes: buffer.length };
  }

  /** Presigned URL for showing a stored object. */
  async urlFor(key: string, expiresInSeconds?: number): Promise<string> {
    return this.storage.getSignedDownloadUrl(key, expiresInSeconds);
  }

  async remove(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  private assertAcceptable(file: UploadedFileLike): void {
    if (!file?.buffer?.length) {
      throw new ValidationFailedException([{ field: 'file', message: 'file is required' }]);
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      throw new ValidationFailedException([
        { field: 'file', message: `file must be one of: ${ALLOWED_IMAGE_TYPES.join(', ')}` },
      ]);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationFailedException([
        { field: 'file', message: `file must be ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB or smaller` },
      ]);
    }
  }

  /**
   * `rotate()` first so EXIF orientation is baked in — without it, portrait
   * phone photos display sideways once the metadata is stripped.
   */
  private async compress(
    file: UploadedFileLike,
  ): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
    const pipeline = sharp(file.buffer)
      .rotate()
      .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });

    try {
      if (file.mimetype === 'image/png') {
        return {
          buffer: await pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL }).toBuffer(),
          contentType: 'image/png',
          extension: '.png',
        };
      }
      if (file.mimetype === 'image/webp') {
        return {
          buffer: await pipeline.webp({ quality: JPEG_QUALITY }).toBuffer(),
          contentType: 'image/webp',
          extension: '.webp',
        };
      }
      return {
        buffer: await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
        contentType: 'image/jpeg',
        extension: extname(file.originalname).toLowerCase() === '.jpeg' ? '.jpeg' : '.jpg',
      };
    } catch (err) {
      // A wrong mimetype or a truncated upload lands here, not on the client.
      this.logger.warn({ err, name: file.originalname }, 'image could not be decoded');
      throw new ValidationFailedException([
        { field: 'file', message: 'file is not a readable image' },
      ]);
    }
  }
}
