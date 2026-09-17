/** Dragino only: `import { dragino } from 'lorawan-decoders/dragino'`. */
import { namespace } from './core/registry.js';
import { DRAGINO_MODELS } from './vendors/dragino/index.js';

export const dragino = namespace(DRAGINO_MODELS);
export { DRAGINO_MODELS };
export type {
  Lht65Telemetry, Lht52Telemetry, Lds02Telemetry, Lwl02Telemetry, Ldds75Telemetry, Lse01Telemetry, Lsn50Telemetry,
} from './vendors/dragino/index.js';
