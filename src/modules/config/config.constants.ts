/**
 * Supported app languages — static config, not database content. Adding a
 * language requires translation work in the app anyway, so this isn't a
 * runtime-editable table (compare src/modules/home/home.service.ts's
 * HOME_CATEGORIES, the same "static config, not catalog data" pattern).
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', flag: '🇬🇧', name: 'English', nativeName: 'English (Default)' },
  { code: 'hi', flag: '🇮🇳', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ml', flag: '🇮🇳', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'ta', flag: '🇮🇳', name: 'Tamil', nativeName: 'தமிழ்' },
] as const;
