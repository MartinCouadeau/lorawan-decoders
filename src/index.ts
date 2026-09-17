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
export type {
  Lht65Telemetry, Lht52Telemetry, Lds02Telemetry, Lwl02Telemetry, Ldds75Telemetry, Lse01Telemetry, Lsn50Telemetry,
} from './vendors/dragino/index.js';
export type {
  SinglePhaseTelemetry, ThreePhaseTelemetry, LightSinglePhaseTelemetry,
  LightThreePhaseTelemetry, CurrentInterfaceTelemetry, SmokeDetectorTelemetry,
} from './vendors/netvox/index.js';

/** Vendor namespaces: `milesight.em310_tilt(payload)`. Keys = model names and aliases, lowercased, separators → `_`. */
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

/** Decode by name. Vendor and model matched case- and separator-insensitively. Unknown → `unknown_model` with a suggestion. */
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

/** True when `decode(vendor, name, …)` would find a decoder. */
export function isModel(vendor: string, name: string): boolean {
  return registry.isModel(vendor, name);
}

/** Every supported model, optionally filtered by vendor. */
export function models(vendor?: string): ModelInfo[] {
  return registry.models(vendor);
}
