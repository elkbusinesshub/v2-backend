import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@/config/configuration';
import type { StorageProvider, UploadParams } from './storage.interface';

const DEFAULT_URL_TTL_SECONDS = 300; // presigned URLs are short-lived by default

/**
 * S3 implementation. Credentials come from the standard AWS chain
 * (env vars locally, IAM task role in production) — never hard-coded.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const storage = config.get('storage', { infer: true });
    this.bucket = storage.bucket;
    this.client = new S3Client({
      region: storage.region,
      ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
      forcePathStyle: storage.forcePathStyle,
    });
  }

  async upload(params: UploadParams): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
    return { key: params.key };
  }

  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = DEFAULT_URL_TTL_SECONDS,
  ): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = DEFAULT_URL_TTL_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
