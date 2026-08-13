import { Test } from '@nestjs/testing';
import { AdStatus } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import { MarketplaceRepository } from '@/modules/marketplace/marketplace.repository';

/**
 * These lock the `where` clause `findAll` builds. The best-sellers search box
 * used to filter its 30 loaded cards client-side across title, seller and
 * category; now that it queries this endpoint instead, the same fields have to
 * match here or searching by vendor name silently stops working.
 */
describe('MarketplaceRepository.findAll', () => {
  let repository: MarketplaceRepository;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [MarketplaceRepository, { provide: PRISMA, useValue: { ad: { findMany } } }],
    }).compile();

    repository = moduleRef.get(MarketplaceRepository);
  });

  it('returns only active ads when no filters are given', async () => {
    await repository.findAll({ limit: 30 });

    const { where, take } = findMany.mock.calls[0][0];
    expect(where).toEqual({ status: AdStatus.ACTIVE });
    expect(take).toBe(30);
  });

  it('searches title, category and both forms of the seller name', async () => {
    await repository.findAll({ query: 'bright spark', limit: 30 });

    const { where } = findMany.mock.calls[0][0];
    expect(where.status).toBe(AdStatus.ACTIVE);
    expect(where.OR).toEqual([
      { title: { contains: 'bright spark' } },
      { categorySlug: { contains: 'bright spark' } },
      { seller: { name: { contains: 'bright spark' } } },
      { seller: { providerProfile: { businessName: { contains: 'bright spark' } } } },
    ]);
  });

  it('combines a category filter with a search as AND, not OR', async () => {
    // The category chip narrows the search; it must not widen it.
    await repository.findAll({ categorySlug: 'cleaning', query: 'deep', limit: 30 });

    const { where } = findMany.mock.calls[0][0];
    expect(where.categorySlug).toBe('cleaning');
    expect(where.OR).toHaveLength(4);
  });

  it('ranks by wishlists, then views, then recency', async () => {
    await repository.findAll({ limit: 30 });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { wishlistCount: 'desc' },
      { viewCount: 'desc' },
      { createdAt: 'desc' },
    ]);
  });
});

describe('MarketplaceRepository seller queries', () => {
  let repository: MarketplaceRepository;
  let db: {
    ad: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    adImage: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      ad: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      adImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [MarketplaceRepository, { provide: PRISMA, useValue: db }],
    }).compile();
    repository = moduleRef.get(MarketplaceRepository);
  });

  it('shows a seller every status, unlike every public read', async () => {
    await repository.findBySeller('u-9');

    const { where, orderBy } = db.ad.findMany.mock.calls[0][0];
    expect(where).toEqual({ sellerId: 'u-9', deletedAt: null });
    expect(where.status).toBeUndefined();
    expect(orderBy).toEqual({ createdAt: 'desc' });
  });

  it('narrows to one status for the listing tabs', async () => {
    await repository.findBySeller('u-9', AdStatus.DRAFT);

    expect(db.ad.findMany.mock.calls[0][0].where).toEqual({
      sellerId: 'u-9',
      deletedAt: null,
      status: AdStatus.DRAFT,
    });
  });

  it('numbers new photos in the order they were given', async () => {
    await repository.create('u-9', { title: 'X' } as never, ['a.jpg', 'b.jpg']);

    expect(db.ad.create.mock.calls[0][0].data.images.create).toEqual([
      { key: 'a.jpg', sortOrder: 0 },
      { key: 'b.jpg', sortOrder: 1 },
    ]);
  });

  it('leaves photos untouched when imageKeys is omitted', async () => {
    await repository.update('ad-1', { title: 'X' });

    expect(db.adImage.deleteMany).not.toHaveBeenCalled();
    expect(db.adImage.createMany).not.toHaveBeenCalled();
  });

  it('clears photos when given an empty list', async () => {
    // Distinct from omitting it: this is "remove them all".
    await repository.update('ad-1', {}, []);

    expect(db.adImage.deleteMany).toHaveBeenCalledWith({ where: { adId: 'ad-1' } });
    expect(db.adImage.createMany).not.toHaveBeenCalled();
  });

  it('replaces photos wholesale inside one transaction', async () => {
    await repository.update('ad-1', {}, ['c.jpg']);

    expect(db.$transaction).toHaveBeenCalled();
    expect(db.adImage.deleteMany).toHaveBeenCalledWith({ where: { adId: 'ad-1' } });
    expect(db.adImage.createMany).toHaveBeenCalledWith({
      data: [{ adId: 'ad-1', key: 'c.jpg', sortOrder: 0 }],
    });
  });

  it('soft delete also pauses, so the ad leaves every public list', async () => {
    // Public reads filter on status, not deletedAt — without the pause a
    // deleted ad would keep appearing in the rails.
    await repository.softDelete('ad-1');

    const { data } = db.ad.update.mock.calls[0][0];
    expect(data.status).toBe(AdStatus.PAUSED);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});
