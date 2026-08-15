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
