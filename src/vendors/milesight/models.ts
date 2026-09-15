import { round } from '../../core/reader.js';
import type { KeySpec, ModelDefinition } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { COMMON_ATTRIBUTES, SHORT_SERIAL, VS_ATTRIBUTES } from './attributes.js';
import {
  GAS_SENTINELS, alarmDistance, alarmTemperature, battery, co2Ppm, distanceMm, enumState,
  history, humidityPct, lightLevel, mergeChannels, numeric, soundLevels, struct, temperatureC,
  tiltAngles, udlDistanceAlarm,
} from './channels.js';
import { decodeTlv, keysOf, type ChannelMap, type TelemetryOf } from './tlv.js';

const SOURCE =
  'Milesight public payload documentation (github.com/Milesight-IoT/SensorDecoders READMEs). ' +
  'Implemented clean-room from the documented channel tables; no vendor code reused.';

function model<M extends ChannelMap, N extends string, A extends string = never>(
  name: N,
  description: string,
  channels: M,
  opts: { aliases?: readonly A[]; attributes?: ChannelMap } = {},
): ModelDefinition<TelemetryOf<M>, N | A> {
  const map = mergeChannels(opts.attributes ?? COMMON_ATTRIBUTES, channels);
  return {
    vendor: 'Milesight',
    model: name,
    description,
    source: SOURCE,
    keys: keysOf(map) as KeySpec<TelemetryOf<M>>,
    ...(opts.aliases ? { aliases: opts.aliases } : {}),
    decode: (bytes, ctx) => decodeTlv(bytes, map, ctx),
  };
}

// --- EM400 series: TLD (ToF) and MUD (mmWave) share one map ------------------
const EM400 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/82': distanceMm(),
  '05/00': enumState('position', { 0: 'normal', 1: 'tilt' }),
  '83/67': alarmTemperature(),
  '84/82': alarmDistance(),
};

// --- WS series ---------------------------------------------------------------
const WS101 = {
  '01/75': battery(),
  'ff/2e': enumState('button_event', { 1: 'short_press', 2: 'long_press', 3: 'double_press' }),
};

const WS201 = {
  '01/75': battery(),
  '03/82': distanceMm(),
  '04/d6': numeric({ key: 'remaining', type: 'u8', unit: Unit.PERCENT }),
};

const WS301 = {
  '01/75': battery(),
  '03/00': enumState('magnet_status', { 0: 'close', 1: 'open' }),
  '04/00': enumState('tamper_status', { 0: 'installed', 1: 'uninstalled' }),
};

const WS302 = {
  '01/75': battery(),
  '05/5b': soundLevels(),
};

// 03/00 is the magnet on WS301 and the leak sensor here.
const WS303 = {
  '01/75': battery(),
  '03/00': enumState('leakage_status', { 0: 'normal', 1: 'leak' }),
};

// --- EM300 series ------------------------------------------------------------
type TempHumidity = { temperature?: number; humidity?: number };
const TEMP_HUMIDITY_KEYS = { temperature: Unit.CELSIUS, humidity: Unit.PERCENT } as const;

const EM300_SLD = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': enumState('leakage_status', { 0: 'normal', 1: 'leak' }),
  '20/ce': history<TempHumidity & { leakage_status?: string }>(
    8,
    { ...TEMP_HUMIDITY_KEYS, leakage_status: null },
    (r, emit) => {
      emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1) });
      emit.reading({ key: 'leakage_status', value: r.u8() === 1 ? 'leak' : 'normal' });
    },
  ),
};

const EM300_TH = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '20/ce': history<TempHumidity>(7, TEMP_HUMIDITY_KEYS, (r, emit) => {
    emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
    emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1) });
  }),
};

// AM103 adds CO2 on 07/7d; the AM103L variant adds light on 06/cb.
const AM103 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '06/cb': lightLevel(),
  '07/7d': co2Ppm(),
  '20/ce': history<TempHumidity & { co2?: number }>(9, { ...TEMP_HUMIDITY_KEYS, co2: Unit.PPM }, (r, emit) => {
    emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
    emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1) });
    emit.reading({ key: 'co2', unit: Unit.PPM, value: r.u16le() });
  }),
};

// --- EM500 series ------------------------------------------------------------
const EM500_UDL = {
  '01/75': battery(),
  '03/82': distanceMm(),
  '83/e9': udlDistanceAlarm(),
  '20/ce': history<{ distance?: number }>(6, { distance: Unit.MILLIMETRE }, (r, emit) => {
    emit.reading({ key: 'distance', unit: Unit.MILLIMETRE, value: r.u16le() });
  }),
};

// Signed kPa, no divisor (vendor example 037b0a00 → 10 kPa).
const EM500_PP = {
  '01/75': battery(),
  '03/7b': numeric({ key: 'pressure', type: 'i16le', unit: Unit.KILOPASCAL }),
  '20/ce': history<{ pressure?: number }>(6, { pressure: Unit.KILOPASCAL }, (r, emit) => {
    emit.reading({ key: 'pressure', unit: Unit.KILOPASCAL, value: r.i16le() });
  }),
};

const EM310_TILT = {
  '01/75': battery(),
  '03/cf': tiltAngles(),
};

// --- AM308L: tVOC is `tvoc` (µg/m³) on 08/e6, `tvoc_index` on 08/7d ----------
type Am308History = TempHumidity & {
  pir?: string; light_level?: number; co2?: number; barometric_pressure?: number;
  pm2_5?: number; pm10?: number;
};
const AM308_HISTORY_KEYS = {
  ...TEMP_HUMIDITY_KEYS, pir: null, light_level: Unit.INDEX, co2: Unit.PPM,
  barometric_pressure: Unit.HECTOPASCAL, pm2_5: Unit.MICROGRAM_PER_M3, pm10: Unit.MICROGRAM_PER_M3,
} as const;

function am308History<K extends 'tvoc' | 'tvoc_index'>(tvocKey: K, tvocDivisor: number, tvocUnit: Unit) {
  return history<Am308History & { [P in K]?: number }>(
    20,
    { ...AM308_HISTORY_KEYS, [tvocKey]: tvocUnit } as KeySpec<Am308History & { [P in K]?: number }>,
    (r, emit) => {
      emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16le() / 2, 1) });
      emit.reading({ key: 'pir', value: r.u8() === 1 ? 'trigger' : 'idle' });
      emit.reading({ key: 'light_level', unit: Unit.INDEX, value: r.u8() });
      emit.reading({ key: 'co2', unit: Unit.PPM, value: r.u16le() });
      emit.reading({ key: tvocKey, unit: tvocUnit, value: round(r.u16le() / tvocDivisor, 2) });
      emit.reading({ key: 'barometric_pressure', unit: Unit.HECTOPASCAL, value: round(r.u16le() / 10, 1) });
      emit.reading({ key: 'pm2_5', unit: Unit.MICROGRAM_PER_M3, value: r.u16le() });
      emit.reading({ key: 'pm10', unit: Unit.MICROGRAM_PER_M3, value: r.u16le() });
    },
  );
}

const AM308L = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': enumState('pir', { 0: 'idle', 1: 'trigger' }),
  '06/cb': lightLevel(),
  '07/7d': co2Ppm(),
  '08/7d': numeric({ key: 'tvoc_index', type: 'u16le', unit: Unit.INDEX, divisor: 100, decimals: 2 }),
  '08/e6': numeric({ key: 'tvoc', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '09/73': numeric({ key: 'barometric_pressure', type: 'u16le', unit: Unit.HECTOPASCAL, divisor: 10, decimals: 1 }),
  '0b/7d': numeric({ key: 'pm2_5', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0c/7d': numeric({ key: 'pm10', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0e/01': enumState('buzzer_status', { 0: 'off', 1: 'on' }),
  '20/ce': am308History('tvoc_index', 100, Unit.INDEX),
  '21/ce': am308History('tvoc', 1, Unit.MICROGRAM_PER_M3),
};

// --- GS301: ids shifted down one vs AM308L; h2s at two resolutions, one key --
const GS301 = {
  '01/75': battery(),
  '02/67': temperatureC(),
  '03/68': humidityPct(),
  '04/7d': numeric({ key: 'nh3', type: 'u16le', unit: Unit.PPM, divisor: 100, decimals: 2, sentinels: GAS_SENTINELS }),
  '05/7d': numeric({ key: 'h2s', type: 'u16le', unit: Unit.PPM, divisor: 100, decimals: 2, sentinels: GAS_SENTINELS }),
  '06/7d': numeric({ key: 'h2s', type: 'u16le', unit: Unit.PPM, divisor: 1000, decimals: 3, sentinels: GAS_SENTINELS }),
  '07/ea': struct<{ calibration_result?: string }>(5, { calibration_result: null }, (r, emit) => {
    const sensor = r.u8();
    const sensorName = sensor === 0 ? 'nh3' : sensor === 1 ? 'h2s' : `unknown(${sensor})`;
    const type = r.u8();
    const raw = r.i16le();
    const code = r.u8();
    const RESULT: Record<number, string> = {
      0: 'success', 1: 'sensor_version_mismatch', 2: 'i2c_communication_error',
    };
    emit.attribute('calibration_sensor', sensorName);
    emit.attribute('calibration_type', type === 0 ? 'factory' : 'manual');
    emit.attribute('calibration_value', round(raw / (sensor === 1 ? 1000 : 100), 3));
    emit.reading({ key: 'calibration_result', value: RESULT[code] ?? `unknown(${code})` });
  }),
  'ff/7c': struct<Record<never, never>>(43, {}, (r, emit) => emit.attribute('sensor_id', r.ascii(43))),
};

// --- VS132 -------------------------------------------------------------------
const VS132 = {
  '03/d2': numeric({ key: 'total_counter_in', type: 'u32le', unit: Unit.COUNT }),
  '04/d2': numeric({ key: 'total_counter_out', type: 'u32le', unit: Unit.COUNT }),
  '05/cc': struct<{ periodic_counter_in?: number; periodic_counter_out?: number }>(
    4,
    { periodic_counter_in: Unit.COUNT, periodic_counter_out: Unit.COUNT },
    (r, emit) => {
      emit.reading({ key: 'periodic_counter_in', unit: Unit.COUNT, value: r.u16le() });
      emit.reading({ key: 'periodic_counter_out', unit: Unit.COUNT, value: r.u16le() });
    },
  ),
};

export const MILESIGHT_MODELS = [
  model('EM400-TLD', 'ToF laser distance/level sensor with temperature', EM400, { aliases: ['EM400TLD'] }),
  model('EM400-MUD', 'mmWave distance/level sensor with temperature', EM400, { aliases: ['EM400MUD'] }),
  model('EM300-SLD', 'Temperature, humidity and spot water-leak sensor', EM300_SLD, { aliases: ['EM300SLD'] }),
  model('EM300-TH', 'Temperature and humidity sensor', EM300_TH, { aliases: ['EM300TH'] }),
  model('EM310-TILT', 'Three-axis tilt sensor with per-axis thresholds', EM310_TILT, { aliases: ['EM310TILT'] }),
  model('EM500-UDL', 'Ultrasonic distance/level sensor', EM500_UDL, { aliases: ['EM500UDL'] }),
  model('EM500-PP', 'Pipe pressure sensor', EM500_PP, { aliases: ['EM500PP'] }),
  model('WS101', 'Smart button', WS101, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('WS201', 'Smart fill-level sensor', WS201),
  model('WS301', 'Magnetic contact / door sensor', WS301, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('WS302', 'Sound level sensor', WS302),
  model('WS303', 'Spot water-leak sensor', WS303),
  model('AM103', 'Temperature, humidity and CO2 sensor (AM103L adds light level)', AM103, { aliases: ['AM103L'] }),
  model('AM308L', 'Indoor air quality sensor (CO2, tVOC, PM, PIR)', AM308L),
  model('GS301', 'Odour/gas sensor (NH3, H2S)', GS301),
  model('VS132', '3D ToF people counter', VS132, { aliases: ['VS132-P'], attributes: VS_ATTRIBUTES }),
] as const;
