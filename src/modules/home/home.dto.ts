/** Shapes match the Flutter models in lib/data/models/{home,provider}_models.dart. */

export class PromoBannerDto {
  title!: string;
  subtitle!: string;
  ctaLabel!: string;
  tag!: string;
  icon!: string;
}

/** One tile on the home grid — navigates to a vertical (taxi, stay, ...). */
export class HomeCategoryDto {
  id!: string;
  name!: string;
  icon!: string;
  colorHex!: number;
}

export class BestSellerDto {
  id!: string;
  name!: string;
  initials!: string;
  category!: string;
  priceLabel!: string;
  rating!: number;
  colorHex!: number;
  verified!: boolean;
}

export class HomeFeedDto {
  userName!: string;
  location!: string;
  promo!: PromoBannerDto;
  categories!: HomeCategoryDto[];
  bestSellers!: BestSellerDto[];
}
