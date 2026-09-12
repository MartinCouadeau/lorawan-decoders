import { DecoderRegistry } from './core/registry.js';
import type { DecodeRequest, DecodedUplink } from './core/types.js';
import { MILESIGHT_MODELS } from './vendors/milesight/index.js';
import { NETVOX_MODELS } from './vendors/netvox/index.js';
import { ELLENEX_MODELS } from './vendors/ellenex/index.js';
import { DRAGINO_MODELS } from './vendors/dragino/index.js';

export * from './core/index.js';
export { MILESIGHT_MODELS } from './vendors/milesight/index.js';
export { NETVOX_MODELS } from './vendors/netvox/index.js';
export { ELLENEX_MODELS } from './vendors/ellenex/index.js';
export { DRAGINO_MODELS } from './vendors/dragino/index.js';

/** Registry preloaded with every model this library ships. */
export const registry = new DecoderRegistry()
  .registerAll(MILESIGHT_MODELS)
  .registerAll(NETVOX_MODELS)
  .registerAll(ELLENEX_MODELS)
  .registerAll(DRAGINO_MODELS);

export function decode(request: DecodeRequest): DecodedUplink {
  return registry.decode(request);
}

export type VendorId = 'milesight' | 'netvox' | 'ellenex' | 'dragino';

/** Build a registry with only the vendors you need, to keep bundles small. */
export function createRegistry(...vendors: VendorId[]): DecoderRegistry {
  const r = new DecoderRegistry();
  const sets = {
    milesight: MILESIGHT_MODELS, netvox: NETVOX_MODELS, ellenex: ELLENEX_MODELS, dragino: DRAGINO_MODELS,
  };
  for (const v of vendors) r.registerAll(sets[v]);
  return r;
}
