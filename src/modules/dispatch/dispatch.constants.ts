/** Socket.IO namespace for driver offers and live positions. */
export const DISPATCH_NAMESPACE = '/dispatch';

/**
 * How far out to look for a partner, in kilometres.
 *
 * Wide enough that a thin city still finds somebody, tight enough that nobody
 * is offered a pickup they would spend twenty minutes reaching.
 */
export const DISPATCH_RADIUS_KM = 7;

/**
 * How long a request stays on offer before it is given up as unanswered.
 *
 * A rider staring at a spinner needs an answer, and a wrong one — "no drivers"
 * when somebody would have taken it in another ten seconds — is better than no
 * answer at all.
 */
export const OFFER_WINDOW_SECONDS = 60;

/**
 * A partner whose last heartbeat is older than this is treated as gone, even
 * if their row still says online — an app killed mid-shift never gets to say
 * so, and dispatching to it would strand the rider.
 */
export const HEARTBEAT_STALE_SECONDS = 90;

/** How many partners one request is offered to at once. */
export const MAX_OFFERS_PER_REQUEST = 10;

/** Length of the pickup OTP the rider reads out to the driver. */
export const PICKUP_OTP_LENGTH = 4;

/**
 * The youngest a partner may be.
 *
 * A commercial licence in India is 20; a private one is 18. This is the floor
 * for taking a registration at all, not a substitute for reading the licence —
 * that is what verification is for.
 */
export const MIN_DRIVER_AGE_YEARS = 18;

/** Beyond this the date is a typo, not a birthday. */
export const MAX_DRIVER_AGE_YEARS = 100;

/** Average year, leap years included — this is an age check, not a diary. */
export const MILLISECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * How far ahead a licence may be dated before the date is a typo.
 *
 * No licence anywhere runs for three decades, so a year beyond this was
 * mistyped rather than issued.
 */
export const MAX_LICENCE_YEARS_AHEAD = 30;
