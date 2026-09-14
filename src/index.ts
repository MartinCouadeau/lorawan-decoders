import { DecoderRegistry, namespace } from './core/registry.js';
import type { Detailed, ModelInfo, Options, Payload, Telemetry } from './core/types.js';
import { MILESIGHT_MODELS } from './vendors/milesight/index.js';
import { NETVOX_MODELS } from './vendors/netvox/index.js';
import { ELLENEX_MODELS } from './vendors/ellenex/index.js';
import { DRAGINO_MODELS } from './vendors/dragino/index.js';

export * from './core/index.js';
export { MILESIGHT_MODELS } from './vendors/milesight/index.js';
export { NETVOX_MODELS } from './vendors/netvox/index.js';
export { ELLENEX_MODELS } from './vendors/ellenex/index.js';
export { DRAGINO_MODELS } from './vendors/dragino/index.js';
export type { EllenexTelemetry, EllenexScaling, ScalingProfile } from './vendors/ellenex/index.js';
export type { Lht65Telemetry } from './vendors/dragino/index.js';
export type {
  SinglePhaseTelemetry, ThreePhaseTelemetry, LightSinglePhaseTelemetry,
  LightThreePhaseTelemetry, CurrentInterfaceTelemetry,
} from './vendors/netvox/index.js';

/**
 * Typed vendor namespaces: `milesight.em310_tilt(payload)`. Property names are
 * the model names lowercased with separators replaced by `_`; aliases are
 * present too (`milesight.em310tilt`). Each accessor returns that model's
 * telemetry type.
 */
export const milesight = namespace(MILESIGHT_MODELS);
export const netvox = namespace(NETVOX_MODELS);
export const ellenex = namespace(ELLENEX_MODELS);
export const dragino = namespace(DRAGINO_MODELS);

/** Registry preloaded with every model this library ships. */
export const registry = new DecoderRegistry()
  .registerAll(MILESIGHT_MODELS)
  .registerAll(NETVOX_MODELS)
  .registerAll(ELLENEX_MODELS)
  .registerAll(DRAGINO_MODELS);

export type Vendor = 'Milesight' | 'Netvox' | 'Ellenex' | 'Dragino';

/**
 * Decode by vendor and model name. Both are matched case-insensitively and
 * ignoring separators, so `EM310-TILT`, `EM310TILT`, `em310_tilt` and
 * `Em310 Tilt` all resolve to the same decoder. Unknown names throw
 * `DecodeError` with code `unknown_model` and a did-you-mean suggestion.
 */
export function decode(
  vendor: Vendor | (string & {}),
  model: string,
  payload: Payload,
  options?: Options & { detailed?: false },
): Telemetry;
export function decode(
  vendor: Vendor | (string & {}),
  model: string,
  payload: Payload,
  options: Options & { detailed: true },
): Detailed;
export function decode(vendor: string, model: string, payload: Payload, options?: Options): Telemetry | Detailed;
export function decode(vendor: string, model: string, payload: Payload, options?: Options): Telemetry | Detailed {
  return registry.decode(vendor, model, payload, options);
}

/** True when `decode(vendor, name, …)` would find a decoder. Same normalization as `decode`. */
export function isModel(vendor: string, name: string): boolean {
  return registry.isModel(vendor, name);
}

/** Every supported model, optionally filtered by vendor. */
export function models(vendor?: string): ModelInfo[] {
  return registry.models(vendor);
}
