import type { ModelDefinition } from '../../core/types.js';
import { LHT65_KEYS, decodeLht65, type Lht65Telemetry } from './lht65.js';
import { LDS02_KEYS, LWL02_KEYS, decodeLds02, decodeLwl02, type Lds02Telemetry, type Lwl02Telemetry } from './contact.js';
import { LDDS75_KEYS, decodeLdds75, type Ldds75Telemetry } from './ldds75.js';
import { LSE01_KEYS, decodeLse01, type Lse01Telemetry } from './lse01.js';
import { LHT52_KEYS, decodeLht52, type Lht52Telemetry } from './lht52.js';
import { LSN50_KEYS, decodeLsn50, type Lsn50Telemetry } from './lsn50v2.js';

const SOURCE =
  'Dragino user manuals (wiki.dragino.com) and the Apache-2.0 TTN Device Repository entries. ' +
  'Implemented from the documented byte layout; no vendor code reused.';

const LHT65: ModelDefinition<Lht65Telemetry, 'LHT65' | 'LHT65N'> = {
  vendor: 'Dragino', model: 'LHT65', aliases: ['LHT65N'], fPort: 2, source: SOURCE,
  description: 'Temperature and humidity sensor with external probe input (DS18B20, ADC, counter, interrupt)',
  keys: LHT65_KEYS, decode: decodeLht65,
};

const LHT52: ModelDefinition<Lht52Telemetry, 'LHT52'> = {
  vendor: 'Dragino', model: 'LHT52', fPort: 2, source: SOURCE,
  description: 'Temperature and humidity sensor with optional DS18B20 probe',
  keys: LHT52_KEYS, decode: decodeLht52,
};

const LDS02: ModelDefinition<Lds02Telemetry, 'LDS02'> = {
  vendor: 'Dragino', model: 'LDS02', fPort: 10, source: SOURCE,
  description: 'Door sensor with open count and last open duration',
  keys: LDS02_KEYS, decode: decodeLds02,
};

const LWL02: ModelDefinition<Lwl02Telemetry, 'LWL02'> = {
  vendor: 'Dragino', model: 'LWL02', fPort: 10, source: SOURCE,
  description: 'Water leak sensor with leak count and last leak duration',
  keys: LWL02_KEYS, decode: decodeLwl02,
};

const LDDS75: ModelDefinition<Ldds75Telemetry, 'LDDS75'> = {
  vendor: 'Dragino', model: 'LDDS75', fPort: 2, source: SOURCE,
  description: 'Ultrasonic distance sensor with optional DS18B20 probe',
  keys: LDDS75_KEYS, decode: decodeLdds75,
};

const LSE01: ModelDefinition<Lse01Telemetry, 'LSE01'> = {
  vendor: 'Dragino', model: 'LSE01', fPort: 2, source: SOURCE,
  description: 'Soil moisture, temperature and conductivity sensor',
  keys: LSE01_KEYS, decode: decodeLse01,
};

const LSN50V2: ModelDefinition<Lsn50Telemetry, 'LSN50V2' | 'LSN50' | 'LSN50-V2'> = {
  vendor: 'Dragino', model: 'LSN50V2', aliases: ['LSN50', 'LSN50-V2'], fPort: 2, source: SOURCE,
  description: 'Sensor node in MOD=1: SHT temperature/humidity, DS18B20, ADC, digital input',
  keys: LSN50_KEYS, decode: decodeLsn50,
};

export const DRAGINO_MODELS = [LHT65, LHT52, LDS02, LWL02, LDDS75, LSE01, LSN50V2] as const;
