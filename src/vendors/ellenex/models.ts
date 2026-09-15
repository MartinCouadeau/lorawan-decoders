import type { DecodeContext, DecodeResult, KeySpec, ModelDefinition, Telemetry } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { looksLikeCbor } from './cbor.js';
import { ELLENEX_FPORT, decodeLegacy, type LegacyOptions, type LegacyReading } from './legacy.js';
import { V6_KEYS, decodeV6, type V6Options } from './v6.js';

const SOURCE =
  'Ellenex public payload decoders (github.com/ellenex/lorawan-payload-decoders) and the ' +
  'Apache-2.0 TTN Device Repository codecs, verified against their published test vectors. ' +
  'Implemented from the documented layout; no vendor code reused (their repo carries no licence).';

/** V6 maps are self-describing, so every model may emit any V6 key. */
const V6_TELEMETRY_KEYS: Record<string, Unit | null> = Object.fromEntries(
  Object.values(V6_KEYS).map((s) => [s.key, s.key === 'dry_contact' ? null : s.unit]),
);

export interface EllenexTelemetry extends Telemetry {
  battery_voltage?: number;
  pressure?: number;
  pressure_raw?: number;
  differential_pressure?: number;
  differential_pressure_raw?: number;
  level?: number;
  level_raw?: number;
  temperature?: number;
  temperature_raw?: number;
  distance?: number;
  current?: number;
  current_1?: number;
  current_2?: number;
  current_3?: number;
  current_4?: number;
  input_voltage?: number;
  adc_raw?: number;
  pulse_count?: number;
  dry_contact?: string;
  sensor_reading?: number;
}

/** Two payload generations per model. Detected by shape (CBOR map header = V6); `scaling.generation` overrides. */
function ellenexModel<N extends string, A extends string>(
  name: N,
  alias: A,
  description: string,
  legacy: LegacyOptions,
  v6: V6Options = {},
): ModelDefinition<EllenexTelemetry, N | A> {
  const keys: Record<string, Unit | null> = { ...V6_TELEMETRY_KEYS };
  for (const spec of [legacy.primary, legacy.secondary]) {
    if (!spec) continue;
    keys[spec.key] = spec.unit;
    keys[spec.rawKey] = Unit.RAW;
  }
  return {
    vendor: 'Ellenex',
    model: name,
    aliases: [alias],
    description,
    source: SOURCE,
    fPort: ELLENEX_FPORT,
    keys: keys as KeySpec<EllenexTelemetry>,
    decode(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
      const forced = ctx.options.scaling?.['generation'];
      const isV6 = forced === 'v6' || (forced !== 'legacy' && looksLikeCbor(bytes));
      return isV6 ? decodeV6(bytes, ctx, v6) : decodeLegacy(bytes, ctx, legacy);
    },
  };
}

const pressure: LegacyReading = { key: 'pressure', unit: Unit.KILOPASCAL, rawKey: 'pressure_raw' };
const differential: LegacyReading = {
  key: 'differential_pressure', unit: Unit.KILOPASCAL, rawKey: 'differential_pressure_raw',
};
const level: LegacyReading = { key: 'level', unit: Unit.METRE, rawKey: 'level_raw' };
const temperature: LegacyReading = { key: 'temperature', unit: Unit.CELSIUS, rawKey: 'temperature_raw' };
const sensorReading: LegacyReading = { key: 'sensor_reading', unit: Unit.RAW, rawKey: 'sensor_reading' };

export const ELLENEX_MODELS = [
  // --- single-sense pressure -------------------------------------------------
  ellenexModel('PTS2-L', 'PTS2L', 'Submersible pressure transmitter', { primary: pressure }),
  ellenexModel('PTS3-L', 'PTS3L', 'Submersible pressure transmitter (3-series)', { primary: pressure }),
  ellenexModel('PTC2-L', 'PTC2L', 'Compact pressure transmitter', { primary: pressure }),
  ellenexModel('PTF2-L', 'PTF2L', 'Flush pressure transmitter', { primary: pressure }),
  ellenexModel('PDS2-L', 'PDS2L', 'Differential pressure sensor', { primary: differential }),

  // --- single-sense level ----------------------------------------------------
  ellenexModel('PLS2-L', 'PLS2L', 'Submersible level sensor', { primary: level }),
  ellenexModel('PLC2-L', 'PLC2L', 'Compact level sensor', { primary: level }),
  ellenexModel('PLM2-L', 'PLM2L', 'Level sensor, mid range', { primary: level }),

  // --- multi-sense: primary reading plus temperature -------------------------
  ellenexModel('PTD2-L', 'PTD2L', 'Pressure transmitter with temperature',
    { primary: pressure, secondary: temperature }),
  ellenexModel('PDT2-L', 'PDT2L', 'Differential pressure with temperature (V6 reports DP in pascals)',
    { primary: differential, secondary: temperature }, { differentialPressureInPascals: true }),
  ellenexModel('PLD2-L', 'PLD2L', 'Level sensor with temperature',
    { primary: level, secondary: temperature }),

  // --- configurable input ----------------------------------------------------
  ellenexModel('RS1-L', 'RS1L', 'Universal sensor interface (4-20 mA, 0-10 V, PT100/PT1000, or pulse)',
    { primary: sensorReading, secondary: temperature }),
] as const;
