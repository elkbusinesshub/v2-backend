import type { Readable } from 'node:stream';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface UploadParams {
  key: string;
  body: Buffer | Readable;
  contentType: string;
}

/**
 * Storage abstraction — application code depends on this interface only.
 * Swapping S3 for R2/GCS/MinIO means providing a new implementation in
 * StorageModule; no business code changes. (MinIO/localstack already work
 * through S3_ENDPOINT.)
 *
 * Convention: clients upload directly via presigned URLs; the API never
 * proxies file bytes.
 */
export interface StorageProvider {
  upload(params: UploadParams): Promise<{ key: string }>;
  /** Presigned GET — for private objects (e.g. KYC documents). */
  getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Presigned PUT — hand to the mobile app for direct upload. */
  getSignedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
