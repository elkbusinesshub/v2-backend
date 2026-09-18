/**
 * The listing flow's categories: a seller posts, a buyer browses and contacts
 * them directly. Nothing here is booked through the app.
 *
 * Their own slugs rather than `cleaning` / `elkstay` / `repairing`: those
 * belong to the booking verticals, whose screens list every ad in their slug.
 * A listing posted here must not turn up in ELK Clean as something to book.
 */
export const LISTING_CATEGORIES = [
  'listing_cleaning',
  'listing_stay',
  'listing_repair',
  'listing_tool_rental',
] as const;

export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

/** A page of browse results when the app does not ask for a size. */
export const DEFAULT_LISTINGS_PAGE = 20;

export const MAX_LISTINGS_PAGE = 50;

/** Photos a seller may attach — the same cap the marketplace applies. */
export const MAX_LISTING_IMAGES = 6;
