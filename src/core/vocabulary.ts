import { Unit } from './units.js';

/**
 * The cross-vendor telemetry vocabulary. One key, one unit, forever.
 *
 * Every decoder in this library emits keys from this table with exactly this
 * unit. `null` marks a state or event whose value is a string or boolean and
 * which therefore has no unit. Adding a key to a decoder means adding a row
 * here first; the vocabulary test fails otherwise.
 *
 * Naming rules (docs/naming.md):
 *   1. snake_case, lowercase ASCII.
 *   2. Bare name = the device's primary/built-in sensor for that quantity.
 *      Extra sensors of the same quantity take a suffix: _external, _1 _2 _3,
 *      _x _y _z, _in _out, _eq _max.
 *   3. Same quantity in a different unit is a different key.
 *   4. Every key is in this table.
 *   5. States and events are strings; booleans only for two-valued flags.
 */
export const VOCABULARY: Record<string, Unit | null> = {
  // --- power -----------------------------------------------------------------
  battery: Unit.PERCENT,
  battery_voltage: Unit.VOLT,
  battery_low: null,
  battery_status: null,

  // --- environment -----------------------------------------------------------
  temperature: Unit.CELSIUS,
  temperature_external: Unit.CELSIUS,
  temperature_raw: Unit.RAW,
  temperature_alarm: null,
  humidity: Unit.PERCENT,
  barometric_pressure: Unit.HECTOPASCAL,
  illuminance: Unit.LUX,
  light_level: Unit.INDEX,

  // --- air quality -----------------------------------------------------------
  co2: Unit.PPM,
  tvoc: Unit.MICROGRAM_PER_M3,
  tvoc_index: Unit.INDEX,
  pm2_5: Unit.MICROGRAM_PER_M3,
  pm10: Unit.MICROGRAM_PER_M3,
  nh3: Unit.PPM,
  nh3_status: null,
  h2s: Unit.PPM,
  h2s_status: null,
  calibration_result: null,

  // --- distance, level, pressure ---------------------------------------------
  distance: Unit.MILLIMETRE,
  distance_alarm: null,
  distance_alarm_value: Unit.MILLIMETRE,
  distance_mutation: Unit.MILLIMETRE,
  level: Unit.METRE,
  level_raw: Unit.RAW,
  remaining: Unit.PERCENT,
  pressure: Unit.KILOPASCAL,
  pressure_raw: Unit.RAW,
  differential_pressure: Unit.KILOPASCAL,
  differential_pressure_raw: Unit.RAW,

  // --- electrical ------------------------------------------------------------
  current: Unit.MILLIAMPERE,
  current_1: Unit.MILLIAMPERE,
  current_2: Unit.MILLIAMPERE,
  current_3: Unit.MILLIAMPERE,
  current_4: Unit.MILLIAMPERE,
  current_alarm: null,
  current_alarm_1: null,
  current_alarm_2: null,
  current_alarm_3: null,
  channel_1: Unit.RAW,
  channel_2: Unit.RAW,
  channel_3: Unit.RAW,
  input_voltage: Unit.VOLT,
  input_level: null,
  adc_raw: Unit.RAW,
  sensor_reading: Unit.RAW,

  // --- motion, position ------------------------------------------------------
  angle_x: Unit.DEGREE,
  angle_y: Unit.DEGREE,
  angle_z: Unit.DEGREE,
  angle_threshold_x: null,
  angle_threshold_y: null,
  angle_threshold_z: null,
  position: null,
  pir: null,

  // --- acoustics -------------------------------------------------------------
  sound_level: Unit.DECIBEL,
  sound_level_eq: Unit.DECIBEL,
  sound_level_max: Unit.DECIBEL,

  // --- counters --------------------------------------------------------------
  pulse_count: Unit.COUNT,
  total_counter_in: Unit.COUNT,
  total_counter_out: Unit.COUNT,
  periodic_counter_in: Unit.COUNT,
  periodic_counter_out: Unit.COUNT,

  // --- states and events -----------------------------------------------------
  leakage_status: null,
  magnet_status: null,
  tamper_status: null,
  buzzer_status: null,
  button_event: null,
  dry_contact: null,
  interrupt: null,
};

export const KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Throws at module load if a decoder declares a key outside the vocabulary. */
export function assertVocabulary(model: string, keys: Record<string, Unit | null>): void {
  for (const [key, unit] of Object.entries(keys)) {
    if (!(key in VOCABULARY)) {
      throw new Error(`${model}: key "${key}" is not in the telemetry vocabulary (src/core/vocabulary.ts)`);
    }
    if (VOCABULARY[key] !== unit) {
      throw new Error(
        `${model}: key "${key}" declared with unit ${String(unit)} but the vocabulary says ${String(VOCABULARY[key])}`,
      );
    }
  }
}
