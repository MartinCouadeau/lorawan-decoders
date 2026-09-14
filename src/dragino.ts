/** Dragino only: `import { dragino } from 'lorawan-decoders/dragino'`. */
import { namespace } from './core/registry.js';
import { DRAGINO_MODELS } from './vendors/dragino/index.js';

export const dragino = namespace(DRAGINO_MODELS);
export { DRAGINO_MODELS };
export type { Lht65Telemetry } from './vendors/dragino/index.js';
