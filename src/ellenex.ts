/** Ellenex only: `import { ellenex } from 'lorawan-decoders/ellenex'`. */
import { namespace } from './core/registry.js';
import { ELLENEX_MODELS } from './vendors/ellenex/index.js';

export const ellenex = namespace(ELLENEX_MODELS);
export { ELLENEX_MODELS };
export type { EllenexTelemetry, EllenexScaling, ScalingProfile } from './vendors/ellenex/index.js';
