import type { Unit } from './units.js';

export type TelemetryValue = number | string | boolean;

/** What a decode call returns: one flat object of sensor readings. */
export type Telemetry = Record<string, TelemetryValue>;

/** Internal reading before flattening. `key` is a vocabulary key. `at` set = buffered record → history. */
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
  /** Byte offset, when meaningful. */
  offset?: number;
  channel?: string;
}

/** Full decode result, returned with `detailed: true`. */
export interface Detailed<T extends object = Telemetry> {
  telemetry: T;
  /** Unit per numeric telemetry key. States/events absent. */
  units: Partial<Record<keyof T, Unit>>;
  /** Buffered records, one per device timestamp, oldest first. */
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
  /** Throw on the first warning instead of returning a partial result. */
  strict?: boolean;
  /** Vendor-specific configuration; keys listed in docs/api.md. */
  scaling?: Record<string, number | string>;
  /** Return `Detailed` instead of the flat telemetry object. */
  detailed?: boolean;
}

/** Declared vocabulary of one model: every key it can emit, with its unit. */
export type KeySpec<T extends object> = { [K in keyof T]-?: Unit | null };

/** One model, or a family sharing a wire format. `T` = telemetry type; `A` = model name and aliases as literals (drives namespace typing). */
export interface ModelDefinition<T extends object = Telemetry, A extends string = string> {
  vendor: string;
  /** Canonical model name as the vendor prints it, e.g. `EM400-TLD`. */
  model: string;
  /** Other names for the same decoder. Matched like `model`. */
  aliases?: readonly A[];
  /** Human description for the generated device table. */
  description: string;
  /** fPort the vendor documents for uplinks, when they document one. */
  fPort?: number;
  /** Further documented ports (datalog, configuration responses). No fPort warning on these. */
  otherFPorts?: readonly number[];
  /** Documentation the format was implemented from. Printed in docs. */
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
  /** Canonical name, e.g. `EM310-TILT`. Any spelling works in `decode`. */
  name: string;
  /** Property name on the vendor namespace, e.g. `em310_tilt`. */
  accessor: string;
  aliases: string[];
  fPort?: number;
  /** Further documented ports (datalog, configuration responses). */
  otherFPorts?: number[];
  description: string;
  keys: Record<string, Unit | null>;
}
