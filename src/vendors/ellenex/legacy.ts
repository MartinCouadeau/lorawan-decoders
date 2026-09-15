import { ByteReader, round, toHex } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Ellenex legacy frame, 8 bytes, fPort 15:
 *   0-2  undocumented (exposed as `header` attribute)
 *   3-4  primary reading, int16 BE, raw count
 *   5-6  secondary reading, int16 BE, raw count (temperature where fitted)
 *   7    battery, uint8, ×0.1 V
 * The readings are counts; the conversion is supplied per device. Without a
 * scaling profile they are emitted on `<key>_raw` with a warning.
 */

export const ELLENEX_FPORT = 15;

export type ScalingProfile = 'adc14' | 'microamp' | 'direct';

export interface EllenexScaling {
  profile?: ScalingProfile;
  /** Full-scale sensor range, in the output unit: metres for level, kPa for pressure. */
  range?: number;
  /** Liquid density relative to water; 1.0 water, ~0.85 diesel. */
  density?: number;
}

const OBSERVED_HEADER_FIRST_BYTE = 0x01;

export interface LegacyReading {
  /** Engineering key once scaled, e.g. `level`. */
  key: string;
  unit: Unit;
  /** Key for the unscaled count, e.g. `level_raw`. */
  rawKey: string;
}

export interface LegacyOptions {
  /** What the primary reading measures on this model. */
  primary: LegacyReading;
  /** Present only on the multi-sense models. */
  secondary?: LegacyReading;
}

export function decodeLegacy(bytes: Uint8Array, ctx: DecodeContext, opts: LegacyOptions): DecodeResult {
  if (bytes.length !== 8) {
    throw new DecodeError('payload_too_short', `Ellenex legacy frames are 8 bytes; got ${bytes.length}`, {
      length: bytes.length,
      hint: 'a variable-length payload is probably Version 6 (CBOR)',
    });
  }

  const r = new ByteReader(bytes);
  const header = r.take(3);
  const primaryRaw = r.i16be();
  const secondaryRaw = r.i16be();
  const battery = round(r.u8() * 0.1, 1);

  const attributes: Attributes = { header: toHex(header) };
  const readings: Reading[] = [];

  if (header[0] !== OBSERVED_HEADER_FIRST_BYTE) {
    // Byte 0 is always 0x01 in every documented sample; anything else may mean a different layout.
    ctx.warn({
      code: 'undocumented_field',
      offset: 0,
      message:
        `header byte 0 is 0x${(header[0] ?? 0).toString(16)}, expected 0x01; on FMS2-L byte 0 selects a different layout`,
    });
  }

  readings.push(scaleReading(primaryRaw, opts.primary, ctx));

  if (opts.secondary) {
    readings.push({ key: opts.secondary.rawKey, unit: Unit.RAW, value: secondaryRaw });
    ctx.warn({
      code: 'unscaled_value',
      message: `${opts.secondary.key} reported as a raw count on ${opts.secondary.rawKey}; no documented scaling`,
    });
  }

  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: battery });

  return { readings, attributes };
}

function scaleReading(raw: number, spec: LegacyReading, ctx: DecodeContext): Reading {
  const scaling = ctx.options.scaling as EllenexScaling | undefined;
  const profile = scaling?.profile;

  if (!profile) {
    ctx.warn({
      code: 'unscaled_value',
      message:
        `${spec.key} is a raw sensor count, reported on ${spec.rawKey}; ` +
        `pass scaling { profile, range, density } to get ${spec.key} in ${spec.unit}`,
    });
    return { key: spec.rawKey, unit: Unit.RAW, value: raw };
  }

  const range = scaling?.range;
  const density = scaling?.density ?? 1;

  let value: number;
  switch (profile) {
    // 4-20 mA loop on a 14-bit ADC: 4 mA = 10 % of full scale, 20 mA = 90 %.
    case 'adc14':
      requireRange(range, profile);
      value = ((raw - 1638.3) * range!) / 13106.4 / density;
      break;
    // Raw value in µA over a 4000-20000 µA loop.
    case 'microamp':
      requireRange(range, profile);
      value = (range! * (raw - 4000)) / 16000 / density;
      break;
    // Already in the target unit; density only.
    case 'direct':
      value = raw / density;
      break;
  }

  return { key: spec.key, unit: spec.unit, value: round(value, 3) };
}

function requireRange(range: number | undefined, profile: ScalingProfile): void {
  if (range === undefined) {
    throw new DecodeError(
      'unsupported_report',
      `Ellenex scaling profile "${profile}" needs scaling.range (the sensor's full-scale range)`,
      { profile },
    );
  }
}
