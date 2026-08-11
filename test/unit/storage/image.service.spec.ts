import sharp from 'sharp';
import { DomainException } from '@/common/errors/domain.exceptions';

import { ImageService, MAX_UPLOAD_BYTES, type UploadedFileLike } from '@/storage/image.service';
import type { StorageProvider } from '@/storage/storage.interface';

/** ValidationFailedException carries the specific text in `details`, not `message`. */
async function detailOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const details = (err as DomainException & { details?: { message: string }[] }).details;
    return details?.[0]?.message ?? (err as Error).message;
  }
  throw new Error('expected the call to reject');
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 110 } },
  })
    .jpeg()
    .toBuffer();
}

function file(buffer: Buffer, overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  return {
    buffer,
    mimetype: 'image/jpeg',
    originalname: 'photo.jpg',
    size: buffer.length,
    ...overrides,
  };
}

describe('ImageService', () => {
  let storage: jest.Mocked<StorageProvider>;
  let service: ImageService;

  beforeEach(() => {
    storage = {
      upload: jest.fn().mockImplementation((p: { key: string }) => ({ key: p.key })),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
      getSignedUploadUrl: jest.fn(),
      delete: jest.fn(),
    };
    service = new ImageService(storage);
  });

  it('downscales a large image to fit 800x600 and keeps its aspect ratio', async () => {
    const stored = await service.storeImage(file(await jpeg(3000, 2000)), 'ads');

    const uploaded = storage.upload.mock.calls[0]![0].body as Buffer;
    const meta = await sharp(uploaded).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(533); // 3000x2000 -> fit inside, ratio preserved
    expect(stored.bytes).toBe(uploaded.length);
  });

  it('does not enlarge an image that is already smaller', async () => {
    await service.storeImage(file(await jpeg(320, 240)), 'ads');

    const meta = await sharp(storage.upload.mock.calls[0]![0].body as Buffer).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
  });

  it('keeps PNG as PNG and JPEG as JPEG', async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#0a7' },
    })
      .png()
      .toBuffer();

    await service.storeImage(file(png, { mimetype: 'image/png', originalname: 'a.png' }), 'ads');
    expect(storage.upload.mock.calls[0]![0].contentType).toBe('image/png');
    expect(storage.upload.mock.calls[0]![0].key).toMatch(/\.png$/);

    await service.storeImage(file(await jpeg(100, 100)), 'ads');
    expect(storage.upload.mock.calls[1]![0].contentType).toBe('image/jpeg');
  });

  it('namespaces the key by purpose and year, and never trusts the filename', async () => {
    await service.storeImage(
      file(await jpeg(100, 100), { originalname: '../../etc/passwd.jpg' }),
      'provider-docs',
    );

    const key = storage.upload.mock.calls[0]![0].key;
    expect(key).toMatch(/^provider-docs\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
    expect(key).not.toContain('..');
  });

  it('rejects a disallowed content type', async () => {
    await expect(
      service.storeImage(file(await jpeg(10, 10), { mimetype: 'application/pdf' }), 'ads'),
    ).rejects.toBeInstanceOf(DomainException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not a decodable image', async () => {
    await expect(
      detailOf(service.storeImage(file(Buffer.from('not an image')), 'ads')),
    ).resolves.toMatch(/not a readable image/);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects an empty or missing file', async () => {
    await expect(detailOf(service.storeImage(file(Buffer.alloc(0)), 'ads'))).resolves.toMatch(
      /required/,
    );
    await expect(
      detailOf(service.storeImage(undefined as unknown as UploadedFileLike, 'ads')),
    ).resolves.toMatch(/required/);
  });

  it('rejects a file over the size cap before touching storage', async () => {
    const big = file(await jpeg(10, 10), { size: MAX_UPLOAD_BYTES + 1 });
    await expect(detailOf(service.storeImage(big, 'ads'))).resolves.toMatch(/8MB or smaller/);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('returns a presigned URL for the stored object', async () => {
    const stored = await service.storeImage(file(await jpeg(50, 50)), 'ads');
    expect(stored.url).toBe('https://signed.example/x');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(stored.key);
  });
});
