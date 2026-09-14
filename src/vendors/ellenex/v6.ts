import { round } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { decodeCbor } from './cbor.js';

/**
 * Ellenex Version 6 payloads are a CBOR map with short text keys, so there are
 * no byte offsets to get wrong — but the key vocabulary is undocumented outside
 * their decoder sources, and it is case-sensitive in a way that will bite you:
 *
 *   `v` is battery voltage in millivolts.
 *   `V` is a raw voltage input channel, also in millivolts.
 *
 * One character apart, different meanings, both plausible on the same device.
 *
 * Wire units are converted to the library vocabulary: bar → kPa (×100),
 * metres → millimetres for `distance`, millivolts → volts.
 */

interface KeySpec {
  key: string;
  unit: Unit;
  /** Wire value multiplied by this. */
  factor?: number;
  decimals?: number;
}

const BAR_TO_KPA = 100;
const PA_TO_KPA = 0.001;

export const V6_KEYS: Record<string, KeySpec> = {
  v: { key: 'battery_voltage', unit: Unit.VOLT, factor: 0.001, decimals: 3 },
  P: { key: 'pressure', unit: Unit.KILOPASCAL, factor: BAR_TO_KPA, decimals: 2 },
  DP: { key: 'differential_pressure', unit: Unit.KILOPASCAL, factor: BAR_TO_KPA, decimals: 2 },
  T: { key: 'temperature', unit: Unit.CELSIUS, decimals: 2 },
  L: { key: 'level', unit: Unit.METRE, decimals: 4 },
  D: { key: 'distance', unit: Unit.MILLIMETRE, factor: 1000, decimals: 1 },
  mA: { key: 'current', unit: Unit.MILLIAMPERE, factor: 0.001, decimals: 3 },
  mA1: { key: 'current_1', unit: Unit.MILLIAMPERE, factor: 0.001, decimals: 3 },
  mA2: { key: 'current_2', unit: Unit.MILLIAMPERE, factor: 0.001, decimals: 3 },
  mA3: { key: 'current_3', unit: Unit.MILLIAMPERE, factor: 0.001, decimals: 3 },
  mA4: { key: 'current_4', unit: Unit.MILLIAMPERE, factor: 0.001, decimals: 3 },
  V: { key: 'input_voltage', unit: Unit.VOLT, factor: 0.001, decimals: 3 },
  mV: { key: 'adc_raw', unit: Unit.RAW },
  Pu: { key: 'pulse_count', unit: Unit.COUNT },
  DC: { key: 'dry_contact', unit: Unit.INDEX },
};

export interface V6Options {
  /** PDT2-L reports DP in pascals rather than bar. */
  differentialPressureInPascals?: boolean;
  /** Liquid density for level conversion; 1.0 water. */
  density?: number;
}

export function decodeV6(bytes: Uint8Array, ctx: DecodeContext, opts: V6Options = {}): DecodeResult {
  const decoded = decodeCbor(bytes);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded) || decoded instanceof Uint8Array) {
    throw new DecodeError('unsupported_report', 'Ellenex V6 payload is not a CBOR map', {
      decoded: typeof decoded,
    });
  }

  const readings: Reading[] = [];
  const configuredDensity = ctx.options.scaling?.['density'];
  const density = opts.density ?? (typeof configuredDensity === 'number' ? configuredDensity : 1);

  for (const [wireKey, rawValue] of Object.entries(decoded)) {
    const spec = V6_KEYS[wireKey];
    if (!spec) {
      ctx.warn({
        code: 'unknown_channel',
        message: `unknown Ellenex V6 key "${wireKey}" (value ${JSON.stringify(rawValue)}) was ignored`,
      });
      continue;
    }

    if (typeof rawValue !== 'number') {
      ctx.warn({
        code: 'undocumented_field',
        message: `Ellenex V6 key "${wireKey}" carried a non-numeric CBOR value`,
      });
      continue;
    }

    if (wireKey === 'DC') {
      readings.push({ key: spec.key, value: rawValue === 0 ? 'closed' : 'open' });
      continue;
    }

    let factor = spec.factor ?? 1;
    if (wireKey === 'DP' && opts.differentialPressureInPascals) factor = PA_TO_KPA;

    let value = rawValue * factor;
    if (wireKey === 'L' && density !== 1) value = value / density;

    readings.push({ key: spec.key, unit: spec.unit, value: round(value, spec.decimals ?? 3) });
  }

  return { readings, attributes: { payload_generation: 'v6' } };
}
