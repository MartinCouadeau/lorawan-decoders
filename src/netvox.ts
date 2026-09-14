/** Netvox only: `import { netvox } from 'lorawan-decoders/netvox'`. */
import { namespace } from './core/registry.js';
import { NETVOX_MODELS } from './vendors/netvox/index.js';

export const netvox = namespace(NETVOX_MODELS);
export { NETVOX_MODELS };
export type {
  SinglePhaseTelemetry, ThreePhaseTelemetry, LightSinglePhaseTelemetry,
  LightThreePhaseTelemetry, CurrentInterfaceTelemetry,
} from './vendors/netvox/index.js';
