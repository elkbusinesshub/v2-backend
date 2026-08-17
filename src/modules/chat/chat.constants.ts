/** Display timezone for chat timestamps. */
export const CHAT_DISPLAY_TIMEZONE = 'Asia/Kolkata';

/** Socket.IO namespace for realtime chat. */
export const CHAT_NAMESPACE = '/chat';

/**
 * Presence line under the contact's name.
 *
 * Static until real presence exists. It is deliberately not a claim about
 * being online — "Tap to view profile" says nothing that can be false.
 */
export const CHAT_CONTACT_SUBTITLE = 'Tap to view profile';

/** Longest inbox preview before it is cut with an ellipsis. */
export const CHAT_PREVIEW_LENGTH = 80;
