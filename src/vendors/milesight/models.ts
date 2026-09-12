import { round } from '../../core/reader.js';
import type { ModelDefinition } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { COMMON_ATTRIBUTES, SHORT_SERIAL, VS_ATTRIBUTES } from './attributes.js';
import {
  GAS_SENTINELS, alarmDistance, alarmTemperature, battery, distanceMm, enumState,
  history, humidityPct, mergeChannels, numeric, soundLevels, struct, temperatureC,
  tiltAngles, udlDistanceAlarm,
} from './channels.js';
import { decodeTlv, type ChannelMap } from './tlv.js';

const SOURCE =
  'Milesight public payload documentation (github.com/Milesight-IoT/SensorDecoders READMEs). ' +
  'Implemented clean-room from the documented channel tables; no vendor code reused.';

function model(
  name: string,
  description: string,
  channels: ChannelMap,
  opts: { aliases?: string[]; attributes?: ChannelMap } = {},
): ModelDefinition {
  const map = mergeChannels(opts.attributes ?? COMMON_ATTRIBUTES, channels);
  return {
    vendor: 'Milesight',
    model: name,
    description,
    source: SOURCE,
    ...(opts.aliases ? { aliases: opts.aliases } : {}),
    decode: (bytes, ctx) => decodeTlv(bytes, map, ctx),
  };
}

// --- EM400 series: ToF / mmWave level, temperature ---------------------------
// The TLD and MUD decode loops are identical; only the sensing technology
// differs. One channel map, two registered models.
const EM400: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/82': distanceMm(),
  '05/00': enumState('position', { 0: 'normal', 1: 'tilt' }),
  '83/67': alarmTemperature(),
  '84/82': alarmDistance(),
};

// --- WS series ---------------------------------------------------------------
const WS101: ChannelMap = {
  '01/75': battery(),
  'ff/2e': enumState('button_event', { 1: 'short_press', 2: 'long_press', 3: 'double_press' }, 'event'),
};

const WS201: ChannelMap = {
  '01/75': battery(),
  '03/82': distanceMm(),
  '04/d6': numeric({ key: 'remaining', kind: 'level', type: 'u8', unit: Unit.PERCENT }),
};

const WS301: ChannelMap = {
  '01/75': battery(),
  '03/00': enumState('magnet_status', { 0: 'close', 1: 'open' }),
  '04/00': enumState('tamper_status', { 0: 'installed', 1: 'uninstalled' }),
};

const WS302: ChannelMap = {
  '01/75': battery(),
  '05/5b': soundLevels(),
};

// Note the collision with WS301: 03/00 is the magnet on WS301 and the leak
// sensor here. Channel maps are per model precisely because of cases like this.
const WS303: ChannelMap = {
  '01/75': battery(),
  '03/00': enumState('leakage_status', { 0: 'normal', 1: 'leak' }),
};

// --- EM300-SLD ---------------------------------------------------------------
const EM300_SLD: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': enumState('leakage_status', { 0: 'normal', 1: 'leak' }),
  '20/ce': history(8, (r, at, emit) => {
    emit.measurement({ key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1), at });
    emit.measurement({ key: 'humidity', kind: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1), at });
    const code = r.u8();
    emit.measurement({ key: 'leakage_status', kind: 'state', value: code === 1 ? 'leak' : 'normal', code, at });
  }),
};

// --- EM300-TH / AM103 --------------------------------------------------------
// Temperature and humidity, with a 20/ce history record of timestamp + the same
// two readings. AM103 adds CO2 on 07/7d; the AM103L variant adds light on 06/cb.
const EM300_TH: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '20/ce': history(7, (r, at, emit) => {
    emit.measurement({ key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1), at });
    emit.measurement({ key: 'humidity', kind: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1), at });
  }),
};

const AM103: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '06/cb': numeric({ key: 'light_level', kind: 'illuminance', type: 'u8', unit: Unit.INDEX }),
  '07/7d': numeric({ key: 'co2', kind: 'co2', type: 'u16le', unit: Unit.PPM }),
  '20/ce': history(9, (r, at, emit) => {
    emit.measurement({ key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1), at });
    emit.measurement({ key: 'humidity', kind: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1), at });
    emit.measurement({ key: 'co2', kind: 'co2', unit: Unit.PPM, value: r.u16le(), at });
  }),
};

// --- EM500 series ------------------------------------------------------------
const EM500_UDL: ChannelMap = {
  '01/75': battery(),
  '03/82': distanceMm(),
  '83/e9': udlDistanceAlarm(),
  '20/ce': history(6, (r, at, emit) => {
    emit.measurement({ key: 'distance', kind: 'distance', unit: Unit.MILLIMETRE, value: r.u16le(), at });
  }),
};

// Pressure here is signed and unscaled — raw kPa, no divisor. Confirmed against
// the vendor's own worked example (037b0a00 -> 10 kPa).
const EM500_PP: ChannelMap = {
  '01/75': battery(),
  '03/7b': numeric({ key: 'pressure', kind: 'pressure', type: 'i16le', unit: Unit.KILOPASCAL }),
  '20/ce': history(6, (r, at, emit) => {
    emit.measurement({ key: 'pressure', kind: 'pressure', unit: Unit.KILOPASCAL, value: r.i16le(), at });
  }),
};

const EM310_TILT: ChannelMap = {
  '01/75': battery(),
  '03/cf': tiltAngles(),
};

// --- AM308L ------------------------------------------------------------------
// tVOC arrives on channel id 0x08 under two different type bytes with two
// different units. Same output key, unit only recoverable from the type byte.
function am308History(tvocDivisor: number, tvocUnit: Unit) {
  return history(20, (r, at, emit) => {
    emit.measurement({ key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1), at });
    emit.measurement({ key: 'humidity', kind: 'humidity', unit: Unit.PERCENT, value: round(r.u16le() / 2, 1), at });
    const pir = r.u8();
    emit.measurement({ key: 'pir', kind: 'occupancy', value: pir === 1 ? 'trigger' : 'idle', code: pir, at });
    emit.measurement({ key: 'light_level', kind: 'illuminance', unit: Unit.INDEX, value: r.u8(), at });
    emit.measurement({ key: 'co2', kind: 'co2', unit: Unit.PPM, value: r.u16le(), at });
    emit.measurement({ key: 'tvoc', kind: 'tvoc', unit: tvocUnit, value: round(r.u16le() / tvocDivisor, 2), at });
    emit.measurement({ key: 'pressure', kind: 'pressure', unit: Unit.HECTOPASCAL, value: round(r.u16le() / 10, 1), at });
    emit.measurement({ key: 'pm2_5', kind: 'particulate', unit: Unit.MICROGRAM_PER_M3, value: r.u16le(), at });
    emit.measurement({ key: 'pm10', kind: 'particulate', unit: Unit.MICROGRAM_PER_M3, value: r.u16le(), at });
  });
}

const AM308L: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': enumState('pir', { 0: 'idle', 1: 'trigger' }, 'occupancy'),
  '06/cb': numeric({ key: 'light_level', kind: 'illuminance', type: 'u8', unit: Unit.INDEX }),
  '07/7d': numeric({ key: 'co2', kind: 'co2', type: 'u16le', unit: Unit.PPM }),
  '08/7d': numeric({ key: 'tvoc', kind: 'tvoc', type: 'u16le', unit: Unit.INDEX, divisor: 100, decimals: 2 }),
  '08/e6': numeric({ key: 'tvoc', kind: 'tvoc', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '09/73': numeric({ key: 'pressure', kind: 'pressure', type: 'u16le', unit: Unit.HECTOPASCAL, divisor: 10, decimals: 1 }),
  '0b/7d': numeric({ key: 'pm2_5', kind: 'particulate', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0c/7d': numeric({ key: 'pm10', kind: 'particulate', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0e/01': enumState('buzzer_status', { 0: 'off', 1: 'on' }),
  '20/ce': am308History(100, Unit.INDEX),
  '21/ce': am308History(1, Unit.MICROGRAM_PER_M3),
};

// --- GS301 -------------------------------------------------------------------
// Channel ids are shifted down by one relative to AM308L: temperature is 0x02,
// humidity 0x03. H2S appears twice at two resolutions.
const GS301: ChannelMap = {
  '01/75': battery(),
  '02/67': temperatureC(),
  '03/68': humidityPct(),
  '04/7d': numeric({ key: 'nh3', kind: 'gas_concentration', type: 'u16le', unit: Unit.PPM, divisor: 100, decimals: 2, sentinels: GAS_SENTINELS }),
  '05/7d': numeric({ key: 'h2s', kind: 'gas_concentration', type: 'u16le', unit: Unit.PPM, divisor: 100, decimals: 2, sentinels: GAS_SENTINELS }),
  '06/7d': numeric({ key: 'h2s', kind: 'gas_concentration', type: 'u16le', unit: Unit.PPM, divisor: 1000, decimals: 3, sentinels: GAS_SENTINELS }),
  '07/ea': struct(5, (r, emit) => {
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
    emit.measurement({
      key: 'calibration_result', kind: 'event', value: RESULT[code] ?? `unknown(${code})`, code,
    });
  }),
  'ff/7c': struct(43, (r, emit) => emit.attribute('sensor_id', r.ascii(43))),
};

// --- VS132 -------------------------------------------------------------------
const VS132: ChannelMap = {
  '03/d2': numeric({ key: 'total_counter', kind: 'counter', type: 'u32le', unit: Unit.COUNT, index: 'in' }),
  '04/d2': numeric({ key: 'total_counter', kind: 'counter', type: 'u32le', unit: Unit.COUNT, index: 'out' }),
  '05/cc': struct(4, (r, emit) => {
    emit.measurement({ key: 'periodic_counter', kind: 'counter', unit: Unit.COUNT, index: 'in', value: r.u16le() });
    emit.measurement({ key: 'periodic_counter', kind: 'counter', unit: Unit.COUNT, index: 'out', value: r.u16le() });
  }),
};

export const MILESIGHT_MODELS: readonly ModelDefinition[] = [
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
];
