import type { DecodeContext, DecodeResult, ModelDefinition } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import type { QuantityKind } from '../../core/units.js';
import { looksLikeCbor } from './cbor.js';
import { ELLENEX_FPORT, decodeLegacy, type LegacyOptions } from './legacy.js';
import { decodeV6, type V6Options } from './v6.js';

const SOURCE =
  'Ellenex public payload decoders (github.com/ellenex/lorawan-payload-decoders) and the ' +
  'Apache-2.0 TTN Device Repository codecs, verified against their published test vectors. ' +
  'Implemented from the documented layout; no vendor code reused (their repo carries no licence).';

/**
 * Ellenex ships two incompatible payload generations under the same model
 * names, and the device does not announce which one it is. We detect by shape:
 * a CBOR map header (0xBF, or 0xA0–0xB7) means Version 6; anything else of
 * 8 bytes is legacy. Callers who know can force it with `scaling.generation`.
 */
function ellenexModel(
  name: string,
  description: string,
  legacy: LegacyOptions,
  v6: V6Options = {},
  aliases: string[] = [],
): ModelDefinition {
  return {
    vendor: 'Ellenex',
    model: name,
    description,
    source: SOURCE,
    fPort: ELLENEX_FPORT,
    ...(aliases.length ? { aliases } : {}),
    decode(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
      const forced = ctx.options.scaling?.['generation'];
      const isV6 = forced === 'v6' || (forced !== 'legacy' && looksLikeCbor(bytes));
      return isV6 ? decodeV6(bytes, ctx, v6) : decodeLegacy(bytes, ctx, legacy);
    },
  };
}

const pressure = (key = 'pressure', kind: QuantityKind = 'pressure') =>
  ({ key, kind, unit: Unit.BAR }) as const;
const level = () => ({ key: 'level', kind: 'level' as QuantityKind, unit: Unit.METRE }) as const;
const temperature = () =>
  ({ key: 'temperature', kind: 'temperature' as QuantityKind, unit: Unit.CELSIUS }) as const;

export const ELLENEX_MODELS: readonly ModelDefinition[] = [
  // --- single-sense pressure -------------------------------------------------
  ellenexModel('PTS2-L', 'Submersible pressure transmitter', { primary: pressure() }, {}, ['PTS2L']),
  ellenexModel('PTS3-L', 'Submersible pressure transmitter (3-series)', { primary: pressure() }, {}, ['PTS3L']),
  ellenexModel('PTC2-L', 'Compact pressure transmitter', { primary: pressure() }, {}, ['PTC2L']),
  ellenexModel('PTF2-L', 'Flush pressure transmitter', { primary: pressure() }, {}, ['PTF2L']),
  ellenexModel('PDS2-L', 'Differential pressure sensor',
    { primary: pressure('differential_pressure', 'differential_pressure') }, {}, ['PDS2L']),

  // --- single-sense level ----------------------------------------------------
  ellenexModel('PLS2-L', 'Submersible level sensor', { primary: level() }, {}, ['PLS2L']),
  ellenexModel('PLC2-L', 'Compact level sensor', { primary: level() }, {}, ['PLC2L']),
  ellenexModel('PLM2-L', 'Level sensor, mid range', { primary: level() }, {}, ['PLM2L']),

  // --- multi-sense: primary reading plus temperature -------------------------
  ellenexModel('PTD2-L', 'Pressure transmitter with temperature',
    { primary: pressure(), secondary: temperature() }, {}, ['PTD2L']),
  ellenexModel('PDT2-L', 'Differential pressure with temperature (reports pascals on V6)',
    { primary: pressure('differential_pressure', 'differential_pressure'), secondary: temperature() },
    { differentialPressureUnit: Unit.PASCAL }, ['PDT2L']),
  ellenexModel('PLD2-L', 'Level sensor with temperature',
    { primary: level(), secondary: temperature() }, {}, ['PLD2L']),

  // --- configurable input ----------------------------------------------------
  ellenexModel('RS1-L', 'Universal sensor interface (4-20 mA, 0-10 V, PT100/PT1000, or pulse)',
    { primary: { key: 'sensor_reading', kind: 'unknown', unit: Unit.RAW }, secondary: temperature() },
    {}, ['RS1L']),
];
