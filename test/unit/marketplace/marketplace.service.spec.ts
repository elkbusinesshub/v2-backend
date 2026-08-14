import { Test } from '@nestjs/testing';
import { AdStatus, Prisma, Role } from '@prisma/client';
import {
  ForbiddenResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import {
  MarketplaceRepository,
  type AdWithSeller,
} from '@/modules/marketplace/marketplace.repository';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service';
import { ImageService } from '@/storage/image.service';

function ad(overrides: Partial<AdWithSeller> = {}): AdWithSeller {
  return {
    id: 'ad-1',
    sellerId: 'u-9',
    title: 'Deep Home Cleaning',
    description: 'Full-home deep clean',
    categorySlug: 'cleaning',
    icon: '🧹',
    price: 180 as never,
    priceUnit: '/ visit',
    locality: 'Koramangala',
    city: 'Bengaluru',
    lat: 12.9352,
    lng: 77.6245,
    attributes: null,
    status: AdStatus.ACTIVE,
    viewCount: 10,
    wishlistCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    seller: { name: 'Ravi K', providerProfile: { businessName: 'Royal Shine Co.' } },
    images: [],
    ...overrides,
  };
}

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let repo: jest.Mocked<MarketplaceRepository>;
  let images: jest.Mocked<ImageService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        {
          provide: MarketplaceRepository,
          useValue: {
            findTopSellers: jest.fn().mockResolvedValue([ad()]),
            findAll: jest.fn().mockResolvedValue([ad()]),
            findById: jest.fn().mockResolvedValue(ad()),
            wishlistedIds: jest.fn().mockResolvedValue(new Set<string>()),
            recordView: jest.fn().mockResolvedValue(true),
            addToWishlist: jest.fn().mockResolvedValue(true),
            removeFromWishlist: jest.fn().mockResolvedValue(true),
            findBySeller: jest.fn().mockResolvedValue([ad()]),
            findOwned: jest.fn().mockResolvedValue(ad()),
            create: jest
              .fn()
              .mockImplementation((_sellerId, data) =>
                Promise.resolve(ad({ ...data, id: 'ad-new' })),
              ),
            update: jest
              .fn()
              .mockImplementation((id, data) => Promise.resolve(ad({ ...data, id }))),
            softDelete: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ImageService,
          useValue: { urlFor: jest.fn().mockResolvedValue('https://signed/x.jpg') },
        },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceService);
    repo = moduleRef.get(MarketplaceRepository);
    images = moduleRef.get(ImageService);
  });

  describe('ranking', () => {
    it('asks for the engagement-ranked list with the caller-supplied limit', async () => {
      await service.topSellers('u-1', 5, 'cleaning');

      expect(repo.findTopSellers).toHaveBeenCalledWith(5, 'cleaning');
    });

    it('defaults the limit when the client does not say', async () => {
      await service.topSellers('u-1');

      expect(repo.findTopSellers).toHaveBeenCalledWith(10, undefined);
    });

    it('exposes both engagement counters on the card', async () => {
      const [card] = await service.topSellers('u-1');

      expect(card).toMatchObject({ viewCount: 10, wishlistCount: 2 });
    });
  });

  describe('card mapping', () => {
    it('prefers the business name over the seller’s personal name', async () => {
      const [card] = await service.topSellers('u-1');
      expect(card!.sellerName).toBe('Royal Shine Co.');
    });

    it('falls back to the personal name when there is no provider profile', async () => {
      repo.findTopSellers.mockResolvedValue([
        ad({ seller: { name: 'Ravi K', providerProfile: null } }),
      ]);

      const [card] = await service.topSellers('u-1');
      expect(card!.sellerName).toBe('Ravi K');
    });

    it('joins the location and skips the parts the seller left blank', async () => {
      repo.findTopSellers.mockResolvedValue([ad({ locality: null })]);

      const [card] = await service.topSellers('u-1');
      expect(card!.location).toBe('Bengaluru');
    });

    it('marks the ads the caller has saved', async () => {
      repo.wishlistedIds.mockResolvedValue(new Set(['ad-1']));

      const [card] = await service.topSellers('u-1');
      expect(card!.isWishlisted).toBe(true);
    });

    it('presigns image keys, and degrades to no images if storage fails', async () => {
      repo.findTopSellers.mockResolvedValue([ad({ images: [{ key: 'ads/2026/a.jpg' }] })]);
      const [ok] = await service.topSellers('u-1');
      expect(ok!.imageUrls).toEqual(['https://signed/x.jpg']);

      images.urlFor.mockRejectedValue(new Error('S3 down'));
      const [degraded] = await service.topSellers('u-1');
      // A storage hiccup must not blank the whole rail.
      expect(degraded!.imageUrls).toEqual([]);
      expect(degraded!.title).toBe('Deep Home Cleaning');
    });
  });

  describe('detail', () => {
    it('records the view and reflects it in the returned count', async () => {
      const card = await service.detail('ad-1', 'u-1');

      expect(repo.recordView).toHaveBeenCalledWith('ad-1', 'u-1');
      expect(card.viewCount).toBe(11);
    });

    it('does not double-count a user who has already viewed it', async () => {
      repo.recordView.mockResolvedValue(false);

      const card = await service.detail('ad-1', 'u-1');
      expect(card.viewCount).toBe(10);
    });

    it('404s an unknown or inactive ad, without recording a view', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.detail('nope', 'u-1')).rejects.toBeInstanceOf(ResourceNotFoundException);
      expect(repo.recordView).not.toHaveBeenCalled();
    });
  });

  describe('wishlist', () => {
    it('saving bumps the count', async () => {
      await expect(service.setWishlisted('ad-1', 'u-1', true)).resolves.toEqual({
        isWishlisted: true,
        wishlistCount: 3,
      });
    });

    it('unsaving lowers it', async () => {
      await expect(service.setWishlisted('ad-1', 'u-1', false)).resolves.toEqual({
        isWishlisted: false,
        wishlistCount: 1,
      });
    });

    it('saving twice does not inflate the count', async () => {
      repo.addToWishlist.mockResolvedValue(false); // already saved

      await expect(service.setWishlisted('ad-1', 'u-1', true)).resolves.toEqual({
        isWishlisted: true,
        wishlistCount: 2,
      });
    });

    it('404s an unknown ad', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.setWishlisted('nope', 'u-1', true)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('seller-owned listings', () => {
    const seller: AuthUser = {
      id: 'u-9',
      roles: [Role.USER],
      jti: 'j',
      exp: 9999999999,
    };

    it('reports each ad’s status so My Listings can badge it', async () => {
      // my-ads mixes statuses by design, so the card cannot infer it.
      repo.findBySeller.mockResolvedValue([ad({ status: AdStatus.PAUSED })]);

      const [listed] = await service.myAds(seller);

      expect(listed!.status).toBe(AdStatus.PAUSED);
    });

    it('lists the seller their own ads, drafts and paused included', async () => {
      // findBySeller does not filter to ACTIVE — that is the whole point of
      // the My Listings screen.
      await service.myAds(seller);

      expect(repo.findBySeller).toHaveBeenCalledWith('u-9', undefined);
    });

    it('passes a status filter through for the listing tabs', async () => {
      await service.myAds(seller, AdStatus.PAUSED);

      expect(repo.findBySeller).toHaveBeenCalledWith('u-9', AdStatus.PAUSED);
    });

    it('publishes by default and drafts on request', async () => {
      await service.create(seller, {
        title: 'Sofa Shampoo',
        categorySlug: 'cleaning',
        price: 899,
      });
      expect(repo.create.mock.calls[0]![1]).toMatchObject({ status: AdStatus.ACTIVE });

      await service.create(seller, {
        title: 'Draft ad',
        categorySlug: 'cleaning',
        price: 100,
        status: AdStatus.DRAFT,
      });
      expect(repo.create.mock.calls[1]![1]).toMatchObject({ status: AdStatus.DRAFT });
    });

    it('stores uploaded photo keys against the new ad', async () => {
      // The only place in the schema an uploaded key can land.
      await service.create(seller, {
        title: 'Sofa Shampoo',
        categorySlug: 'cleaning',
        price: 899,
        imageKeys: ['ads/a.jpg', 'ads/b.jpg'],
      });

      expect(repo.create.mock.calls[0]![2]).toEqual(['ads/a.jpg', 'ads/b.jpg']);
    });

    it('sends only the fields the seller actually changed', async () => {
      // Spreading undefined would blank the columns left untouched.
      await service.update(seller, 'ad-1', { price: 950 });

      expect(repo.update).toHaveBeenCalledWith('ad-1', { price: 950 }, undefined);
    });

    it('leaves photos alone unless imageKeys is given', async () => {
      // undefined = keep them, [] = remove them all. Collapsing the two would
      // make editing a title wipe the images.
      await service.update(seller, 'ad-1', { title: 'New title' });
      expect(repo.update.mock.calls[0]![2]).toBeUndefined();

      await service.update(seller, 'ad-1', { imageKeys: [] });
      expect(repo.update.mock.calls[1]![2]).toEqual([]);
    });

    it('pauses a listing through the same update path', async () => {
      await service.update(seller, 'ad-1', { status: AdStatus.PAUSED });

      expect(repo.update).toHaveBeenCalledWith('ad-1', { status: AdStatus.PAUSED }, undefined);
    });

    it('refuses to edit or delete somebody else’s listing', async () => {
      repo.findOwned.mockResolvedValue(ad({ sellerId: 'someone-else' }));

      await expect(service.update(seller, 'ad-1', { price: 1 })).rejects.toBeInstanceOf(
        ForbiddenResourceException,
      );
      await expect(service.remove(seller, 'ad-1')).rejects.toBeInstanceOf(
        ForbiddenResourceException,
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('lets an admin manage a listing they do not own', async () => {
      repo.findOwned.mockResolvedValue(ad({ sellerId: 'someone-else' }));
      const admin: AuthUser = { ...seller, roles: [Role.ADMIN] };

      await service.remove(admin, 'ad-1');

      expect(repo.softDelete).toHaveBeenCalledWith('ad-1');
    });

    it('404s a listing that does not exist', async () => {
      repo.findOwned.mockResolvedValue(null);

      await expect(service.remove(seller, 'ad-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('category attributes', () => {
    const seller: AuthUser = { id: 'u-9', roles: [Role.USER], jti: 'j', exp: 9999999999 };

    it('stores validated attributes on create', async () => {
      await service.create(seller, {
        title: 'Swift Dzire',
        categorySlug: 'car_rental',
        price: 2400,
        attributes: { seats: 5, transmission: 'AUTOMATIC' },
      });

      expect(repo.create).toHaveBeenCalledWith(
        'u-9',
        expect.objectContaining({ attributes: { seats: 5, transmission: 'AUTOMATIC' } }),
        [],
      );
    });

    it('rejects attributes the category does not define', async () => {
      await expect(
        service.create(seller, {
          title: 'Deep Clean',
          categorySlug: 'cleaning',
          price: 899,
          attributes: { seats: 5 },
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('writes SQL NULL rather than an empty object when none are supplied', async () => {
      await service.create(seller, { title: 'X', categorySlug: 'cleaning', price: 1 });

      expect(repo.create).toHaveBeenCalledWith(
        'u-9',
        expect.objectContaining({ attributes: Prisma.DbNull }),
        [],
      );
    });

    it('returns attributes on the card so the vertical screens can render them', async () => {
      repo.findTopSellers.mockResolvedValue([ad({ attributes: { seats: 7 } })]);

      const [card] = await service.topSellers('u-1');

      expect(card!.attributes).toEqual({ seats: 7 });
    });

    it('leaves attributes alone on an update that does not mention them', async () => {
      await service.update(seller, 'ad-1', { price: 950 });

      expect(repo.update).toHaveBeenCalledWith(
        'ad-1',
        expect.not.objectContaining({ attributes: expect.anything() }),
        undefined,
      );
    });

    it('validates an update against the category the ad is moving to', async () => {
      // The stored category is still cleaning; the new one is what counts.
      repo.findOwned.mockResolvedValue(ad({ categorySlug: 'cleaning' }));

      await service.update(seller, 'ad-1', {
        categorySlug: 'car_rental',
        attributes: { seats: 5 },
      });

      expect(repo.update).toHaveBeenCalledWith(
        'ad-1',
        expect.objectContaining({ attributes: { seats: 5 } }),
        undefined,
      );
    });

    it('clears stale attributes when an ad is recategorised', async () => {
      // Seats on a cleaning ad would render as nothing; leaving them would
      // also mean the row no longer validates against its own category.
      repo.findOwned.mockResolvedValue(
        ad({ categorySlug: 'car_rental', attributes: { seats: 5 } }),
      );

      await service.update(seller, 'ad-1', { categorySlug: 'cleaning' });

      expect(repo.update).toHaveBeenCalledWith(
        'ad-1',
        expect.objectContaining({ attributes: Prisma.DbNull }),
        undefined,
      );
    });
  });

  describe('default icon', () => {
    const seller: AuthUser = { id: 'u-9', roles: [Role.USER], jti: 'j', exp: 9999999999 };

    it('sets the fallback icon itself rather than leaving it to the column', async () => {
      // The MySQL column default is stored as `?` — the emoji does not survive
      // the DDL path Prisma writes it through, so an ad created without an
      // icon rendered a broken glyph on its card.
      await service.create(seller, { title: 'X', categorySlug: 'cleaning', price: 1 });

      expect(repo.create).toHaveBeenCalledWith('u-9', expect.objectContaining({ icon: '🛍️' }), []);
    });

    it('keeps an icon the seller chose', async () => {
      await service.create(seller, {
        title: 'X',
        categorySlug: 'cleaning',
        price: 1,
        icon: '🧹',
      });

      expect(repo.create).toHaveBeenCalledWith('u-9', expect.objectContaining({ icon: '🧹' }), []);
    });
  });
});
