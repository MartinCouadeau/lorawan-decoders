import { round } from '../../core/reader.js';
import type { DecodeResult, KeySpec, ModelDefinition } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { COMMON_ATTRIBUTES, SHORT_SERIAL, VS_ATTRIBUTES } from './attributes.js';
import {
  EM310_DISTANCE_SENTINELS, EM400_DISTANCE_SENTINELS, EM500_SENTINELS, EM500_SENTINELS_32, FAILED_16, FAILED_8,
  GAS_SENTINELS, HIGH_TEMPERATURE_ALARM, THRESHOLD_ALARM, alarmDistance, alarmTemperature, barometric, battery, co2Ppm,
  counterPair, counterPairAlarm, ctCurrent, ctCurrentAlarm, distanceMm, enumState,
  history, humidityPct, illuminationTriple, lightLevel, mergeChannels, numeric, pir, readNumber, soundLevels, struct,
  temperatureAlarmChange, temperatureC, tiltAngles, udlDistanceAlarm,
} from './channels.js';
import { decodeTlv, keysOf, type ChannelMap, type TelemetryOf } from './tlv.js';

const SOURCE =
  'Milesight public payload documentation (github.com/Milesight-IoT/SensorDecoders READMEs). ' +
  'Implemented clean-room from the documented channel tables; no vendor code reused.';

function model<M extends ChannelMap, N extends string, A extends string = never>(
  name: N,
  description: string,
  channels: M,
  opts: { aliases?: readonly A[]; attributes?: ChannelMap; finish?: (result: DecodeResult) => void } = {},
): ModelDefinition<TelemetryOf<M>, N | A> {
  const map = mergeChannels(opts.attributes ?? COMMON_ATTRIBUTES, channels);
  return {
    vendor: 'Milesight',
    model: name,
    description,
    source: SOURCE,
    keys: keysOf(map) as KeySpec<TelemetryOf<M>>,
    ...(opts.aliases ? { aliases: opts.aliases } : {}),
    decode: (bytes, ctx) => {
      const result = decodeTlv(bytes, map, ctx);
      opts.finish?.(result);
      return result;
    },
  };
}

/** EM400: distance 65000 in a frame that also says `position: tilt` is the tilt switch turning the sensor off, not a range miss. */
function relabelTiltedDistance(result: DecodeResult): void {
  const tilted = result.readings.some((m) => m.key === 'position' && m.value === 'tilt');
  if (!tilted) return;
  for (const m of result.readings) {
    if (m.key === 'distance_status' && m.value === 'out_of_range') m.value = 'tilted';
  }
}

// --- EM400 series: TLD (ToF) and MUD (mmWave) share one map ------------------
// Distance 65000 = out of range or device tilted (field report).
const EM400 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/82': distanceMm(EM400_DISTANCE_SENTINELS),
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
// EM500 user guides: 0xffff = collection failed, 0xfffd = out of range, on
// live and history fields alike (EM500_SENTINELS).
const EM500_UDL = {
  '01/75': battery(),
  '03/82': distanceMm(EM500_SENTINELS),
  '83/e9': udlDistanceAlarm(),
  '20/ce': history<{ distance?: number; distance_status?: string }>(6, { distance: Unit.MILLIMETRE, distance_status: null }, (r, emit) => {
    readNumber(r, emit, { key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE, sentinels: EM500_SENTINELS });
  }),
};

// UINT16 kPa per the user guide (vendor example 037b0a00 → 10 kPa).
const EM500_PP = {
  '01/75': battery(),
  '03/7b': numeric({ key: 'pressure', type: 'u16le', unit: Unit.KILOPASCAL, sentinels: EM500_SENTINELS }),
  '20/ce': history<{ pressure?: number; pressure_status?: string }>(6, { pressure: Unit.KILOPASCAL, pressure_status: null }, (r, emit) => {
    readNumber(r, emit, { key: 'pressure', type: 'u16le', unit: Unit.KILOPASCAL, sentinels: EM500_SENTINELS });
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

// AM307: AM308L without particulate matter; 16-byte history.
const AM307 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': pir(),
  '06/cb': lightLevel(),
  '07/7d': co2Ppm(),
  '08/7d': numeric({ key: 'tvoc_index', type: 'u16le', unit: Unit.INDEX, divisor: 100, decimals: 2 }),
  '08/e6': numeric({ key: 'tvoc', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '09/73': barometric(),
  '0e/01': enumState('buzzer_status', { 0: 'off', 1: 'on' }),
  '20/ce': am307History('tvoc_index', 100, Unit.INDEX),
  '21/ce': am307History('tvoc', 1, Unit.MICROGRAM_PER_M3),
};

function am307History<K extends 'tvoc' | 'tvoc_index'>(tvocKey: K, tvocDivisor: number, tvocUnit: Unit) {
  type T = TempHumidity & { pir?: string; light_level?: number; co2?: number; barometric_pressure?: number } & { [P in K]?: number };
  return history<T>(
    16,
    { ...TEMP_HUMIDITY_KEYS, pir: null, light_level: Unit.INDEX, co2: Unit.PPM, barometric_pressure: Unit.HECTOPASCAL, [tvocKey]: tvocUnit } as KeySpec<T>,
    (r, emit) => {
      emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16le() / 2, 1) });
      emit.reading({ key: 'pir', value: r.u8() === 1 ? 'trigger' : 'idle' });
      emit.reading({ key: 'light_level', unit: Unit.INDEX, value: r.u8() });
      emit.reading({ key: 'co2', unit: Unit.PPM, value: r.u16le() });
      emit.reading({ key: tvocKey, unit: tvocUnit, value: round(r.u16le() / tvocDivisor, 2) });
      emit.reading({ key: 'barometric_pressure', unit: Unit.HECTOPASCAL, value: round(r.u16le() / 10, 1) });
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
// User guide: "ffff or ff = collection error, fffe = polarizing" on every channel.
const GS301 = {
  '01/75': battery(),
  '02/67': temperatureC(FAILED_16),
  '03/68': humidityPct(FAILED_8),
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
  '05/cc': counterPair('periodic_counter_in', 'periodic_counter_out'),
};

// --- VS351: uint16 counters; history is 9 bytes, or 13 when data_type = 1 ----
type Vs351History = {
  periodic_counter_in?: number; periodic_counter_out?: number; total_counter_in?: number; total_counter_out?: number;
};
const VS351 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/cc': counterPair('total_counter_in', 'total_counter_out'),
  '05/cc': counterPair('periodic_counter_in', 'periodic_counter_out'),
  '83/67': alarmTemperature(HIGH_TEMPERATURE_ALARM),
  '84/cc': counterPairAlarm('total_counter_in', 'total_counter_out', 'total_counter_alarm'),
  '85/cc': counterPairAlarm('periodic_counter_in', 'periodic_counter_out', 'periodic_counter_alarm'),
  '20/ce': history<Vs351History>(
    (r) => (r.hasAtLeast(5) && r.peek(5)[4] === 1 ? 13 : 9),
    {
      periodic_counter_in: Unit.COUNT, periodic_counter_out: Unit.COUNT,
      total_counter_in: Unit.COUNT, total_counter_out: Unit.COUNT,
    },
    (r, emit) => {
      const withTotals = r.u8() === 1;
      emit.reading({ key: 'periodic_counter_in', unit: Unit.COUNT, value: r.u16le() });
      emit.reading({ key: 'periodic_counter_out', unit: Unit.COUNT, value: r.u16le() });
      if (withTotals) {
        emit.reading({ key: 'total_counter_in', unit: Unit.COUNT, value: r.u16le() });
        emit.reading({ key: 'total_counter_out', unit: Unit.COUNT, value: r.u16le() });
      }
    },
  ),
};

// --- CT10x: current on the wire is 0.01 A → mA. ffff = collection failure;
// temperature fffd = over range (user guide). 10/99 energy is in the guide only.
const CT103 = {
  '03/97': numeric({ key: 'total_current', type: 'u32le', unit: Unit.AMPERE_HOUR, divisor: 100, decimals: 2 }),
  '04/98': ctCurrent(),
  '09/67': temperatureC(EM500_SENTINELS),
  '10/99': numeric({ key: 'energy', type: 'u32le', unit: Unit.KILOWATT_HOUR, divisor: 100, decimals: 2 }),
  '84/98': ctCurrentAlarm(),
  '89/67': alarmTemperature(THRESHOLD_ALARM, EM500_SENTINELS),
};

// --- EM500 series, more ------------------------------------------------------
// EM500-CO2 guide documents only "all ff" (no out-of-range code).
type Em500Co2History = TempHumidity & {
  temperature_status?: string; humidity_status?: string;
  co2?: number; co2_status?: string; barometric_pressure?: number; barometric_pressure_status?: string;
};
const EM500_CO2 = {
  '01/75': battery(),
  '03/67': temperatureC(FAILED_16),
  '04/68': humidityPct(FAILED_8),
  '05/7d': co2Ppm(FAILED_16),
  '06/73': barometric(FAILED_16),
  '83/d7': temperatureAlarmChange(),
  '20/ce': history<Em500Co2History>(
    11,
    {
      ...TEMP_HUMIDITY_KEYS, temperature_status: null, humidity_status: null,
      co2: Unit.PPM, co2_status: null, barometric_pressure: Unit.HECTOPASCAL, barometric_pressure_status: null,
    },
    (r, emit) => {
      readNumber(r, emit, { key: 'co2', type: 'u16le', unit: Unit.PPM, sentinels: FAILED_16 });
      readNumber(r, emit, { key: 'barometric_pressure', type: 'u16le', unit: Unit.HECTOPASCAL, divisor: 10, decimals: 1, sentinels: FAILED_16 });
      readNumber(r, emit, { key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1, sentinels: FAILED_16 });
      readNumber(r, emit, { key: 'humidity', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1, sentinels: FAILED_8 });
    },
  ),
};

// Depth on the wire is centimetres; the vocabulary `level` is metres.
const EM500_SWL = {
  '01/75': battery(),
  '03/77': numeric({ key: 'level', type: 'u16le', unit: Unit.METRE, divisor: 100, decimals: 2, sentinels: EM500_SENTINELS }),
  '20/ce': history<{ level?: number; level_status?: string }>(6, { level: Unit.METRE, level_status: null }, (r, emit) => {
    readNumber(r, emit, { key: 'level', type: 'u16le', unit: Unit.METRE, divisor: 100, decimals: 2, sentinels: EM500_SENTINELS });
  }),
};

const EM500_PT100 = {
  '01/75': battery(),
  '03/67': temperatureC(EM500_SENTINELS),
  '83/d7': temperatureAlarmChange(),
  '20/ce': history<{ temperature?: number; temperature_status?: string }>(6, { temperature: Unit.CELSIUS, temperature_status: null }, (r, emit) => {
    readNumber(r, emit, { key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1, sentinels: EM500_SENTINELS });
  }),
};

const EM500_LGT = {
  '01/75': battery(),
  '03/94': numeric({ key: 'illuminance', type: 'u32le', unit: Unit.LUX, sentinels: EM500_SENTINELS_32 }),
  '20/ce': history<{ illuminance?: number; illuminance_status?: string }>(8, { illuminance: Unit.LUX, illuminance_status: null }, (r, emit) => {
    readNumber(r, emit, { key: 'illuminance', type: 'u32le', unit: Unit.LUX, sentinels: EM500_SENTINELS_32 });
  }),
};

// Moisture: 1 byte /2 on 04/68, 2 bytes /100 on 04/ca and in history.
type Em500SmtcHistory = {
  conductivity?: number; conductivity_status?: string;
  temperature?: number; temperature_status?: string;
  soil_moisture?: number; soil_moisture_status?: string;
};
const EM500_SMTC = {
  '01/75': battery(),
  '03/67': temperatureC(EM500_SENTINELS),
  '04/68': numeric({ key: 'soil_moisture', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1, sentinels: FAILED_8 }),
  '04/ca': numeric({ key: 'soil_moisture', type: 'u16le', unit: Unit.PERCENT, divisor: 100, decimals: 2, sentinels: EM500_SENTINELS }),
  '05/7f': numeric({ key: 'conductivity', type: 'u16le', unit: Unit.MICROSIEMENS_PER_CM, sentinels: EM500_SENTINELS }),
  '83/d7': temperatureAlarmChange(),
  '20/ce': history<Em500SmtcHistory>(
    10,
    {
      conductivity: Unit.MICROSIEMENS_PER_CM, conductivity_status: null,
      temperature: Unit.CELSIUS, temperature_status: null,
      soil_moisture: Unit.PERCENT, soil_moisture_status: null,
    },
    (r, emit) => {
      readNumber(r, emit, { key: 'conductivity', type: 'u16le', unit: Unit.MICROSIEMENS_PER_CM, sentinels: EM500_SENTINELS });
      readNumber(r, emit, { key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1, sentinels: EM500_SENTINELS });
      readNumber(r, emit, { key: 'soil_moisture', type: 'u16le', unit: Unit.PERCENT, divisor: 100, decimals: 2, sentinels: EM500_SENTINELS });
    },
  ),
};

// User guide: <= 30 mm reported as 30; >= 4.5 m reported as 0.
const EM310_UDL = {
  '01/75': battery(),
  '03/82': distanceMm(EM310_DISTANCE_SENTINELS),
  '04/00': enumState('position', { 0: 'normal', 1: 'tilt' }),
};

const EM300_MCS = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '06/00': enumState('magnet_status', { 0: 'close', 1: 'open' }),
  '20/ce': history<TempHumidity & { magnet_status?: string }>(
    8,
    { ...TEMP_HUMIDITY_KEYS, magnet_status: null },
    (r, emit) => {
      emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      emit.reading({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u8() / 2, 1) });
      emit.reading({ key: 'magnet_status', value: r.u8() === 1 ? 'open' : 'close' });
    },
  ),
};

// --- WS series, more ---------------------------------------------------------
const WS202 = {
  '01/75': battery(),
  '03/00': pir(),
  '04/00': enumState('daylight', { 0: 'dark', 1: 'light' }),
};

// Energy on the wire is watt-hours; the vocabulary `energy` is kWh.
const WS523 = {
  '03/74': numeric({ key: 'voltage', type: 'u16le', unit: Unit.VOLT, divisor: 10, decimals: 1 }),
  '04/80': numeric({ key: 'active_power', type: 'u32le', unit: Unit.WATT }),
  '05/81': numeric({ key: 'power_factor', type: 'u8', unit: Unit.PERCENT }),
  '06/83': numeric({ key: 'energy', type: 'u32le', unit: Unit.KILOWATT_HOUR, divisor: 1000, decimals: 3 }),
  '07/c9': numeric({ key: 'current', type: 'u16le', unit: Unit.MILLIAMPERE }),
  '08/70': enumState('socket_status', { 0: 'off', 1: 'on' }),
};

// --- AM100 series ------------------------------------------------------------
const AM104 = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/6a': numeric({ key: 'activity', type: 'u16le', unit: Unit.INDEX }),
  '06/65': illuminationTriple(),
};

// AM107 tVOC is ppb, not the AM308L µg/m³, so it gets its own key.
const AM107 = {
  ...AM104,
  '07/7d': co2Ppm(),
  '08/7d': numeric({ key: 'tvoc_ppb', type: 'u16le', unit: Unit.PPB }),
  '09/73': barometric(),
};

// --- AM319: AM308L channels plus HCHO (0a/7d) or O3 (0d/7d) ------------------
function am319History<K extends 'tvoc' | 'tvoc_index', X extends 'hcho' | 'o3'>(
  tvocKey: K, tvocDivisor: number, tvocUnit: Unit, extraKey: X, extraUnit: Unit,
) {
  type T = Am308History & { [P in K]?: number } & { [P in X]?: number };
  return history<T>(
    22,
    { ...AM308_HISTORY_KEYS, [tvocKey]: tvocUnit, [extraKey]: extraUnit } as KeySpec<T>,
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
      emit.reading({ key: extraKey, unit: extraUnit, value: round(r.u16le() / 100, 2) });
    },
  );
}

const AM319_BASE = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
  '05/00': pir(),
  '06/cb': lightLevel(),
  '07/7d': co2Ppm(),
  '08/7d': numeric({ key: 'tvoc_index', type: 'u16le', unit: Unit.INDEX, divisor: 100, decimals: 2 }),
  '08/e6': numeric({ key: 'tvoc', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '09/73': barometric(),
  '0b/7d': numeric({ key: 'pm2_5', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0c/7d': numeric({ key: 'pm10', type: 'u16le', unit: Unit.MICROGRAM_PER_M3 }),
  '0e/01': enumState('buzzer_status', { 0: 'off', 1: 'on' }),
};

const AM319_HCHO = {
  ...AM319_BASE,
  '0a/7d': numeric({ key: 'hcho', type: 'u16le', unit: Unit.MILLIGRAM_PER_M3, divisor: 100, decimals: 2 }),
  '20/ce': am319History('tvoc_index', 100, Unit.INDEX, 'hcho', Unit.MILLIGRAM_PER_M3),
  '21/ce': am319History('tvoc', 1, Unit.MICROGRAM_PER_M3, 'hcho', Unit.MILLIGRAM_PER_M3),
};

const AM319_O3 = {
  ...AM319_BASE,
  '0d/7d': numeric({ key: 'o3', type: 'u16le', unit: Unit.PPM, divisor: 100, decimals: 2 }),
  '20/ce': am319History('tvoc_index', 100, Unit.INDEX, 'o3', Unit.PPM),
  '21/ce': am319History('tvoc', 1, Unit.MICROGRAM_PER_M3, 'o3', Unit.PPM),
};

export const MILESIGHT_MODELS = [
  model('EM400-TLD', 'ToF laser distance/level sensor with temperature', EM400, { aliases: ['EM400TLD'], finish: relabelTiltedDistance }),
  model('EM400-MUD', 'mmWave distance/level sensor with temperature', EM400, { aliases: ['EM400MUD'], finish: relabelTiltedDistance }),
  model('EM300-SLD', 'Temperature, humidity and spot water-leak sensor', EM300_SLD, { aliases: ['EM300SLD'] }),
  model('EM300-TH', 'Temperature and humidity sensor', EM300_TH, { aliases: ['EM300TH'] }),
  model('EM310-TILT', 'Three-axis tilt sensor with per-axis thresholds', EM310_TILT, { aliases: ['EM310TILT'] }),
  model('EM500-UDL', 'Ultrasonic distance/level sensor', EM500_UDL, { aliases: ['EM500UDL'] }),
  model('EM500-PP', 'Pipe pressure sensor', EM500_PP, { aliases: ['EM500PP'] }),
  model('EM500-CO2', 'CO2, temperature, humidity and barometric pressure sensor', EM500_CO2, { aliases: ['EM500CO2'] }),
  model('EM500-SWL', 'Submersible water level sensor', EM500_SWL, { aliases: ['EM500SWL'] }),
  model('EM500-PT100', 'PT100 industrial temperature sensor', EM500_PT100, { aliases: ['EM500PT100'] }),
  model('EM500-LGT', 'Light sensor', EM500_LGT, { aliases: ['EM500LGT'] }),
  model('EM500-SMTC', 'Soil moisture, temperature and conductivity sensor', EM500_SMTC, { aliases: ['EM500SMTC'] }),
  model('EM310-UDL', 'Ultrasonic distance/level sensor with tilt', EM310_UDL, { aliases: ['EM310UDL'] }),
  model('EM320-TH', 'Temperature and humidity sensor (EM320 series)', EM300_TH, { aliases: ['EM320TH'] }),
  model('EM300-MCS', 'Temperature, humidity and magnetic contact sensor', EM300_MCS, { aliases: ['EM300MCS'] }),
  model('WS101', 'Smart button', WS101, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('WS201', 'Smart fill-level sensor', WS201),
  model('WS202', 'PIR and light sensor', WS202, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('WS301', 'Magnetic contact / door sensor', WS301, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('WS302', 'Sound level sensor', WS302),
  model('WS303', 'Spot water-leak sensor', WS303),
  model('WS523', 'Smart portable socket (WS523/WS525)', WS523, { aliases: ['WS525'] }),
  model('AM103', 'Temperature, humidity and CO2 sensor (AM103L adds light level)', AM103, { aliases: ['AM103L'] }),
  model('AM104', 'Ambience sensor (temperature, humidity, activity, light)', AM104, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('AM107', 'Ambience sensor (AM104 plus CO2, tVOC, barometric pressure)', AM107, { attributes: { ...COMMON_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('AM307', 'Indoor air quality sensor (CO2, tVOC, PIR, no particulates)', AM307, { aliases: ['AM307L'] }),
  model('AM308L', 'Indoor air quality sensor (CO2, tVOC, PM, PIR)', AM308L, { aliases: ['AM308'] }),
  model('AM319-HCHO', 'Indoor air quality sensor with formaldehyde', AM319_HCHO, { aliases: ['AM319', 'AM319HCHO'] }),
  model('AM319-O3', 'Indoor air quality sensor with ozone', AM319_O3, { aliases: ['AM319O3'] }),
  model('GS301', 'Odour/gas sensor (NH3, H2S)', GS301),
  model('VS132', '3D ToF people counter', VS132, { aliases: ['VS132-P'], attributes: VS_ATTRIBUTES }),
  model('VS351', 'Mini AI thermopile people counter', VS351, { attributes: { ...VS_ATTRIBUTES, ...SHORT_SERIAL } }),
  model('CT103', 'Smart current transformer (CT101/CT103/CT105 share the format)', CT103, { aliases: ['CT101', 'CT105'] }),
] as const;
