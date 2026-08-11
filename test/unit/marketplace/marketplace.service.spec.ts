import { Test } from '@nestjs/testing';
import { AdStatus } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
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
});
