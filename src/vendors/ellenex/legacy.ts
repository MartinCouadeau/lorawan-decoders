import { ByteReader, round } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Ellenex legacy (V4) frame, fPort 15, one or more 8-byte packets:
 *   0-1  device id: last two bytes of the DevEUI in the first packet, frame
 *        counter in later packets
 *   2    data type; 0x00 = sensor reading, anything else = configuration echo
 *   3-4  primary reading, int16 BE, engineering units (mbar, mm)
 *   5-6  secondary reading, int16 BE (temperature 0.01 °C where fitted)
 *   7    battery, uint8, 0.1 V
 * Layout and units confirmed on field captures (see docs/vendor-quirks.md).
 */

export const ELLENEX_FPORT = 15;

export type ScalingProfile = 'adc14' | 'microamp' | 'direct';

export interface EllenexScaling {
  /** Opt-in ADC-count conversion. Not needed for the standard pressure and level models. */
  profile?: ScalingProfile;
  /** Full-scale range in the output unit. Required by `adc14` and `microamp`. */
  range?: number;
  /** Liquid density relative to water; 1.0 water, ~0.85 diesel. */
  density?: number;
}

export interface LegacyReading {
  key: string;
  unit: Unit;
  /** Wire value divided by this gives the vocabulary unit. */
  divisor: number;
  decimals: number;
}

export interface LegacyOptions {
  primary: LegacyReading;
  /** Present only on the multi-sense models. */
  secondary?: LegacyReading;
}

const PACKET = 8;

export function decodeLegacy(bytes: Uint8Array, ctx: DecodeContext, opts: LegacyOptions): DecodeResult {
  if (bytes.length < 3) {
    throw new DecodeError('payload_too_short', `Ellenex legacy frames are ${PACKET} bytes; got ${bytes.length}`, {
      length: bytes.length,
    });
  }

  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};
  let packet = 0;

  while (r.remaining >= 3) {
    const id = r.hex(2);
    if (packet === 0) attributes['device_id'] = id;
    else attributes['frame_counter'] = Number.parseInt(id, 16);

    const dataType = r.u8();
    if (dataType !== 0x00) {
      attributes['data_type'] = dataType;
      attributes['data'] = r.hex(r.remaining);
      ctx.warn({
        code: 'undocumented_field',
        offset: 2,
        message: `data type 0x${dataType.toString(16).padStart(2, '0')} is not a sensor reading; bytes kept in attributes.data`,
      });
      break;
    }

    if (r.remaining < PACKET - 3) {
      ctx.warn({
        code: 'truncated_payload',
        offset: r.offset,
        message: `sensor packet needs ${PACKET} bytes; ${r.remaining + 3} present`,
      });
      break;
    }

    const primaryRaw = r.i16be();
    const secondaryRaw = r.i16be();
    const battery = round(r.u8() * 0.1, 1);

    readings.push(scaleReading(primaryRaw, opts.primary, ctx));
    if (opts.secondary) {
      readings.push({
        key: opts.secondary.key, unit: opts.secondary.unit,
        value: round(secondaryRaw / opts.secondary.divisor, opts.secondary.decimals),
      });
    }
    readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: battery });
    packet++;
  }

  if (packet > 1) attributes['packets'] = packet;
  return { readings, attributes };
}

function scaleReading(raw: number, spec: LegacyReading, ctx: DecodeContext): Reading {
  const scaling = ctx.options.scaling as EllenexScaling | undefined;
  const profile = scaling?.profile;
  const density = scaling?.density ?? 1;

  if (!profile) {
    return { key: spec.key, unit: spec.unit, value: round(raw / spec.divisor, spec.decimals) };
  }

  const range = scaling?.range;
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
    // Wire value already in the output unit; density only.
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
