import { Unit } from './units.js';

/**
 * Key → unit for every telemetry key any decoder may emit. `null` = state or
 * event (string/boolean, no unit). Registration and tests reject keys or units
 * not in this table. Rules: docs/naming.md.
 *
 * Derived keys: `<key>_status` (unit null) is valid for every numeric key in
 * the table. Decoders emit it instead of `<key>` when the device sends a
 * sentinel; see FAULT_STATUS / STATE_STATUS below.
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
  temperature_change: Unit.CELSIUS,
  temperature_alarm: null,
  humidity: Unit.PERCENT,
  humidity_external: Unit.PERCENT,
  soil_moisture: Unit.PERCENT,
  soil_temperature: Unit.CELSIUS,
  conductivity: Unit.MICROSIEMENS_PER_CM,
  barometric_pressure: Unit.HECTOPASCAL,
  illuminance: Unit.LUX,
  illuminance_ir: Unit.LUX,
  illuminance_ir_visible: Unit.LUX,
  light_level: Unit.INDEX,
  daylight: null,
  activity: Unit.INDEX,

  // --- air quality -----------------------------------------------------------
  co2: Unit.PPM,
  tvoc: Unit.MICROGRAM_PER_M3,
  tvoc_index: Unit.INDEX,
  tvoc_ppb: Unit.PPB,
  hcho: Unit.MILLIGRAM_PER_M3,
  o3: Unit.PPM,
  pm2_5: Unit.MICROGRAM_PER_M3,
  pm10: Unit.MICROGRAM_PER_M3,
  nh3: Unit.PPM,
  h2s: Unit.PPM,
  calibration_result: null,

  // --- distance, level, pressure ---------------------------------------------
  distance: Unit.MILLIMETRE,
  distance_change: Unit.MILLIMETRE,
  distance_alarm: null,
  level: Unit.METRE,
  remaining: Unit.PERCENT,
  pressure: Unit.KILOPASCAL,
  differential_pressure: Unit.KILOPASCAL,

  // --- electrical ------------------------------------------------------------
  current: Unit.MILLIAMPERE,
  current_1: Unit.MILLIAMPERE,
  current_2: Unit.MILLIAMPERE,
  current_3: Unit.MILLIAMPERE,
  current_4: Unit.MILLIAMPERE,
  current_max: Unit.MILLIAMPERE,
  current_min: Unit.MILLIAMPERE,
  total_current: Unit.AMPERE_HOUR,
  current_alarm: null,
  current_over_range_alarm: null,
  current_alarm_1: null,
  current_alarm_2: null,
  current_alarm_3: null,
  channel_1: Unit.RAW,
  channel_2: Unit.RAW,
  channel_3: Unit.RAW,
  input_voltage: Unit.VOLT,
  input_level: null,
  voltage: Unit.VOLT,
  active_power: Unit.WATT,
  power_factor: Unit.PERCENT,
  energy: Unit.KILOWATT_HOUR,
  socket_status: null,
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
  open_count: Unit.COUNT,
  open_duration: Unit.MINUTE,
  event_count: Unit.COUNT,
  total_counter_in: Unit.COUNT,
  total_counter_out: Unit.COUNT,
  periodic_counter_in: Unit.COUNT,
  periodic_counter_out: Unit.COUNT,
  total_counter_alarm: null,
  periodic_counter_alarm: null,

  // --- states and events -----------------------------------------------------
  leakage_status: null,
  magnet_status: null,
  tamper_status: null,
  buzzer_status: null,
  button_event: null,
  dry_contact: null,
  interrupt: null,
  alarm: null,
  fire_alarm: null,
};

export const KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Labels used on `<key>_status`. Faults: the device could not measure →
 * status plus a `sensor_fault` warning. States: the device measured and
 * reports a condition on purpose → status only, no warning.
 */
export const FAULT_STATUS = ['collection_failed', 'not_detected'] as const;
export const STATE_STATUS = ['out_of_range', 'below_minimum', 'polarizing', 'tilted', 'not_connected'] as const;
export const SENTINEL_LABELS = [...FAULT_STATUS, ...STATE_STATUS] as const;
export type SentinelLabel = (typeof SENTINEL_LABELS)[number];

export function isFaultStatus(label: string): boolean {
  return (FAULT_STATUS as readonly string[]).includes(label);
}

/** Base numeric key of a derived `<key>_status`, or undefined. */
function statusBase(key: string): string | undefined {
  if (!key.endsWith('_status')) return undefined;
  const base = key.slice(0, -'_status'.length);
  const unit = VOCABULARY[base];
  return unit !== undefined && unit !== null ? base : undefined;
}

export function isVocabularyKey(key: string): boolean {
  return key in VOCABULARY || statusBase(key) !== undefined;
}

/** Unit for a key, including derived `<key>_status` (null). Undefined if unknown. */
export function vocabularyUnit(key: string): Unit | null | undefined {
  if (key in VOCABULARY) return VOCABULARY[key];
  return statusBase(key) !== undefined ? null : undefined;
}

/** Throws if `keys` has an entry missing from VOCABULARY or with a different unit. */
export function assertVocabulary(model: string, keys: Record<string, Unit | null>): void {
  for (const [key, unit] of Object.entries(keys)) {
    const expected = vocabularyUnit(key);
    if (expected === undefined) {
      throw new Error(`${model}: key "${key}" is not in the telemetry vocabulary (src/core/vocabulary.ts)`);
    }
    if (expected !== unit) {
      throw new Error(
        `${model}: key "${key}" declared with unit ${String(unit)} but the vocabulary says ${String(expected)}`,
      );
    }
  }
}
