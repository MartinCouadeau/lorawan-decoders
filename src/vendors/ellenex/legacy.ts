import { ByteReader, round, toHex } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { Attributes, DecodeContext, DecodeResult, Measurement } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import type { QuantityKind } from '../../core/units.js';

/**
 * Ellenex legacy frame — 8 bytes, fPort 15, one layout for the entire product
 * line:
 *
 *   bytes 0-2  undocumented
 *   bytes 3-4  primary reading   (int16, big-endian, signed)
 *   bytes 5-6  secondary reading (int16, big-endian, signed) — temperature where fitted
 *   byte  7    battery, uint8, volts = raw * 0.1
 *
 * Two things about this format are worth stating plainly rather than papering
 * over, because both affect how you must use the output:
 *
 * 1. Bytes 0-2 are not documented anywhere — not in Ellenex's own decoder repo
 *    (all 148 commits), not in the TTN device repository, not in any datasheet.
 *    Observed values are 01 E8 00 and 01 82 00. We surface them as an
 *    attribute rather than guessing.
 *
 * 2. The 16-bit reading is a RAW COUNT, not engineering units. Ellenex supplies
 *    the conversion per device, alongside the EUI, because it depends on the
 *    sensor's pressure range and the liquid's density. Their own sample data is
 *    labelled "pressure -1192 bar", which is physically impossible and shows
 *    what happens when you treat the count as a value.
 *
 *    So by default we emit the raw count with `unit: 'raw'` and a warning. Give
 *    the decoder a scaling profile and it will produce real units.
 */

export const ELLENEX_FPORT = 15;

export type ScalingProfile = 'adc14' | 'microamp' | 'direct';

export interface EllenexScaling {
  profile?: ScalingProfile;
  /** Full-scale sensor range, in the unit you want out (metres, bar, …). */
  range?: number;
  /** Liquid density relative to water; 1.0 water, ~0.85 diesel. */
  density?: number;
}

const OBSERVED_HEADER_FIRST_BYTE = 0x01;

export interface LegacyOptions {
  /** What the primary reading measures on this model. */
  primary: { key: string; kind: QuantityKind; unit: Unit };
  /** Present only on the multi-sense models. */
  secondary?: { key: string; kind: QuantityKind; unit: Unit };
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
  const measurements: Measurement[] = [];

  if (header[0] !== OBSERVED_HEADER_FIRST_BYTE) {
    // Quiet in the normal case, loud when the undocumented field changes —
    // which is the only signal available that something about this device or
    // firmware differs from what the format was validated against.
    ctx.warn({
      code: 'undocumented_field',
      offset: 0,
      message:
        `header byte 0 is 0x${(header[0] ?? 0).toString(16)}; every documented Ellenex sample uses 0x01. ` +
        'Bytes 0-2 are undocumented by the vendor, and on at least one model (FMS2-L) byte 0 selects a ' +
        'different payload layout — treat this reading with suspicion.',
    });
  }

  measurements.push(scaleReading(primaryRaw, opts.primary, ctx));

  if (opts.secondary) {
    measurements.push({
      key: opts.secondary.key,
      kind: opts.secondary.kind,
      unit: Unit.RAW,
      value: secondaryRaw,
    });
    ctx.warn({
      code: 'unscaled_value',
      message:
        `${opts.secondary.key} is reported as a raw count; Ellenex documents no scaling factor for it.`,
    });
  }

  measurements.push({ key: 'battery_voltage', kind: 'battery', unit: Unit.VOLT, value: battery });

  return { measurements, attributes };
}

function scaleReading(
  raw: number,
  spec: LegacyOptions['primary'],
  ctx: DecodeContext,
): Measurement {
  const scaling = ctx.options.scaling as EllenexScaling | undefined;
  const profile = scaling?.profile;

  if (!profile) {
    ctx.warn({
      code: 'unscaled_value',
      message:
        `${spec.key} is a raw sensor count, not ${spec.unit}. Ellenex supplies the conversion per device ` +
        'with the EUI. Pass options.scaling = { profile, range, density } to get engineering units — ' +
        'see docs/vendor-quirks.md.',
    });
    return { key: spec.key, kind: spec.kind, unit: Unit.RAW, value: raw };
  }

  const range = scaling?.range;
  const density = scaling?.density ?? 1;

  let value: number;
  switch (profile) {
    // 4-20 mA loop mapped onto a 14-bit ADC: 10% of full scale is 4 mA,
    // 80% of full scale spans the loop.
    case 'adc14':
      requireRange(range, profile);
      value = ((raw - 1638.3) * range!) / 13106.4 / density;
      break;
    // Raw value already in microamps across a 4000-20000 µA loop.
    case 'microamp':
      requireRange(range, profile);
      value = (range! * (raw - 4000)) / 16000 / density;
      break;
    // Value already in the target unit; density correction only.
    case 'direct':
      value = raw / density;
      break;
  }

  return { key: spec.key, kind: spec.kind, unit: spec.unit, value: round(value, 3) };
}

function requireRange(range: number | undefined, profile: ScalingProfile): void {
  if (range === undefined) {
    throw new DecodeError(
      'unsupported_report',
      `Ellenex scaling profile "${profile}" needs options.scaling.range (the sensor's full-scale range)`,
      { profile },
    );
  }
}
