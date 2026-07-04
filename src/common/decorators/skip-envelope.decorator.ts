import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/**
 * Opts a route out of the standard { success, message, data } envelope.
 * Reserved for endpoints with an externally-mandated format (health probes,
 * webhook acknowledgements, file streams).
 */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);
