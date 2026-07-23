import type { Offer } from '@prisma/client';

export function toOfferJson(offer: Offer): Record<string, unknown> {
  return {
    id: offer.id,
    tagLabel: offer.tagLabel,
    title: offer.title,
    description: offer.description,
    code: offer.code,
    expiry: offer.expiryLabel,
    discountLabel: offer.discountLabel,
    discountSubLabel: offer.discountSubLabel,
    gradientStartHex: offer.gradientStartHex,
    gradientEndHex: offer.gradientEndHex,
  };
}
