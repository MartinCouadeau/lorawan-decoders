/** Milesight only: `import { milesight } from 'lorawan-decoders/milesight'`. */
import { namespace } from './core/registry.js';
import { MILESIGHT_MODELS } from './vendors/milesight/index.js';

export const milesight = namespace(MILESIGHT_MODELS);
export { MILESIGHT_MODELS };
export type { TelemetryOf } from './vendors/milesight/index.js';
