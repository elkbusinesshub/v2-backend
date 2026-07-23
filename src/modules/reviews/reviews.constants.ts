/**
 * Fixed vocabulary of quick-select tags on the rating screen — the app
 * offers these as one-tap chips rather than freeform tag entry.
 */
export const REVIEW_QUICK_TAGS = [
  'On Time',
  'Professional',
  'Thorough Job',
  'Friendly',
  'Great Value',
] as const;

/** Loyalty points shown for leaving a review — a static display value until a real rewards ledger exists. */
export const REVIEW_REWARD_POINTS = 15;

export const REVIEW_MAX_TAGS = REVIEW_QUICK_TAGS.length;
export const REVIEW_MAX_COMMENT_LENGTH = 500;
