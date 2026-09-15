import { Unit } from './units.js';

/**
 * Key → unit for every telemetry key any decoder may emit. `null` = state or
 * event (string/boolean, no unit). Registration and tests reject keys or units
 * not in this table. Rules: docs/naming.md.
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
  temperature_change: Unit.CELSIUS,
  temperature_alarm: null,
  humidity: Unit.PERCENT,
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
  alarm: null,
};

export const KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Throws if `keys` has an entry missing from VOCABULARY or with a different unit. */
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
