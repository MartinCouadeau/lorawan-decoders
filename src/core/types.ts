import type { QuantityKind, Unit } from './units.js';

/**
 * One reading. Vendors disagree about names, widths, endianness and scaling;
 * everything in this library converges here.
 */
export interface Measurement {
  /** Normalized name, snake_case. `temperature`, `distance`, `current`. */
  key: string;
  /** Numeric readings carry a number; enum states carry the decoded label. */
  value: number | string | boolean | null;
  kind: QuantityKind;
  unit?: Unit;
  /** For enum states, the raw wire value behind `value`. */
  code?: number;
  /**
   * Sub-index for devices that report the same quantity several times —
   * phase 1/2/3 on a Netvox R718N3, axis x/y/z on a Milesight EM310-TILT.
   */
  index?: number | string;
  /**
   * Where this came from on the wire, in vendor terms. Milesight: `03/67`.
   * Netvox: `reportType=01`. Kept because it is what you actually need when a
   * value looks wrong at 2am.
   */
  channel?: string;
  /**
   * Set only for buffered/historical readings replayed by the device. Live
   * readings leave this undefined and take the network's receive time.
   */
  at?: string;
}

/** Device metadata: versions, serial numbers, LoRaWAN class. */
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
  | 'vendor_quirk';

export interface DecodeWarning {
  code: WarningCode;
  message: string;
  /** Byte offset the warning refers to, when meaningful. */
  offset?: number;
  channel?: string;
}

export interface DecodedUplink {
  vendor: string;
  model: string;
  measurements: Measurement[];
  attributes: Attributes;
  warnings: DecodeWarning[];
  /** Bytes as received, hex, lowercase. Useful in logs and bug reports. */
  raw: string;
  fPort?: number;
}

/**
 * Per-call knobs. `scaling` exists because some vendors ship devices whose
 * engineering conversion is supplied with the device, not on the wire.
 */
export interface DecodeOptions {
  fPort?: number;
  /**
   * Strict mode turns recoverable problems into thrown errors. Off by default:
   * in production you usually want the six good readings plus a warning, not an
   * exception that drops the whole uplink.
   */
  strict?: boolean;
  /** Vendor-specific configuration; see each vendor's README section. */
  scaling?: Record<string, number | string>;
}

export interface DecodeRequest extends DecodeOptions {
  vendor: string;
  model: string;
  /** Hex string (with or without separators) or raw bytes. */
  payload: string | Uint8Array | number[];
}

/** A decoder for one model, or one family of models sharing a wire format. */
export interface ModelDefinition {
  vendor: string;
  /** Canonical model name as the vendor prints it, e.g. `EM400-TLD`. */
  model: string;
  /** Other spellings seen in the wild. Matched case- and separator-insensitively. */
  aliases?: string[];
  /** Human description for the generated device table. */
  description: string;
  /** fPort the vendor documents for uplinks, when they document one. */
  fPort?: number;
  /** Where the wire format came from. Printed in docs; keeps provenance honest. */
  source: string;
  decode(bytes: Uint8Array, ctx: DecodeContext): DecodeResult;
}

export interface DecodeContext {
  model: string;
  options: DecodeOptions;
  warn(warning: DecodeWarning): void;
}

export interface DecodeResult {
  measurements: Measurement[];
  attributes?: Attributes;
}
