import type { Unit } from './units.js';

export type TelemetryValue = number | string | boolean;

/** What a decode call returns: one flat object of sensor readings. */
export type Telemetry = Record<string, TelemetryValue>;

/**
 * One reading as produced inside a decoder, before flattening. Keys are final
 * vocabulary keys (see vocabulary.ts). `at` marks a buffered record replayed by
 * the device; those go to `history`, never to `telemetry`.
 */
export interface Reading {
  key: string;
  value: TelemetryValue;
  unit?: Unit;
  at?: string;
}

/** Device metadata: versions, serial numbers, multipliers, raw headers. */
export type Attributes = Record<string, string | number | boolean>;

export type WarningCode =
  /** A (channel, type) pair we do not have in the model's map. */
  | 'unknown_channel'
  /** Payload ended mid-field. */
  | 'truncated_payload'
  /** Decoded, but the engineering unit is configured out of band. */
  | 'unscaled_value'
  /** The wire carries bytes nobody has ever documented. */
  | 'undocumented_field'
  /** Device reported a sentinel meaning the sensor is faulty or warming up. */
  | 'sensor_fault'
  /** A known inconsistency in the vendor's own published decoder. */
  | 'vendor_quirk'
  /** Two live readings with the same key in one frame; the last one won. */
  | 'duplicate_key';

export interface Warning {
  code: WarningCode;
  message: string;
  /** Byte offset the warning refers to, when meaningful. */
  offset?: number;
  channel?: string;
}

/** Everything a decode produced. Returned when `detailed: true`. */
export interface Detailed<T extends object = Telemetry> {
  telemetry: T;
  /** Unit per telemetry key. States and events have none and are absent. */
  units: Partial<Record<keyof T, Unit>>;
  /** Buffered records replayed by the device, oldest first, one per timestamp. */
  history: Array<{ ts: string } & Partial<T>>;
  attributes: Attributes;
  warnings: Warning[];
}

export type Encoding = 'hex' | 'base64';

/** Hex string, base64 string (with `encoding: 'base64'`), or raw bytes. */
export type Payload = string | Uint8Array | number[];

export interface Options {
  /** How to read a string payload. Default `'hex'`. */
  encoding?: Encoding;
  fPort?: number;
  /**
   * Strict mode turns recoverable problems into thrown errors. Off by default:
   * in production you usually want the six good readings, not an exception
   * that drops the whole uplink.
   */
  strict?: boolean;
  /** Vendor-specific configuration; see docs/vendor-quirks.md. */
  scaling?: Record<string, number | string>;
  /** Return `Detailed` instead of the flat telemetry object. */
  detailed?: boolean;
}

/** Declared vocabulary of one model: every key it can emit, with its unit. */
export type KeySpec<T extends object> = { [K in keyof T]-?: Unit | null };

/**
 * A decoder for one model, or one family of models sharing a wire format.
 * `T` is the telemetry it emits; `A` is the union of every name it answers to
 * (canonical model name and aliases) as literal types, which is what makes the
 * vendor namespaces autocomplete.
 */
export interface ModelDefinition<T extends object = Telemetry, A extends string = string> {
  vendor: string;
  /** Canonical model name as the vendor prints it, e.g. `EM400-TLD`. */
  model: string;
  /** Other spellings seen in the wild. Matched case- and separator-insensitively. */
  aliases?: readonly A[];
  /** Human description for the generated device table. */
  description: string;
  /** fPort the vendor documents for uplinks, when they document one. */
  fPort?: number;
  /** Where the wire format came from. Printed in docs; keeps provenance honest. */
  source: string;
  /** Every telemetry key this model can emit, with its unit. */
  keys: KeySpec<T>;
  decode(bytes: Uint8Array, ctx: DecodeContext): DecodeResult;
}

export interface DecodeContext {
  model: string;
  options: Options;
  warn(warning: Warning): void;
}

export interface DecodeResult {
  readings: Reading[];
  attributes?: Attributes;
}

/** A model accessor: `milesight.em400_tld(payload)`. */
export interface ModelDecoder<T extends object = Telemetry> {
  (payload: Payload, options?: Options & { detailed?: false }): T;
  (payload: Payload, options: Options & { detailed: true }): Detailed<T>;
  readonly definition: ModelDefinition<T>;
}

/** What `models()` returns for each registered decoder. */
export interface ModelInfo {
  vendor: string;
  /** Canonical name, e.g. `EM310-TILT`. Pass it, or any spelling of it, to `decode`. */
  name: string;
  /** Property name on the vendor namespace, e.g. `em310_tilt`. */
  accessor: string;
  aliases: string[];
  fPort?: number;
  description: string;
  keys: Record<string, Unit | null>;
}
