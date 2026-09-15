import type { ModelDefinition } from '../../core/types.js';
import { LHT65_KEYS, decodeLht65, type Lht65Telemetry } from './lht65.js';

const SOURCE =
  'Dragino LHT65/LHT65N user manuals (wiki.dragino.com) and the Apache-2.0 TTN Device Repository ' +
  'entries. Implemented from the documented byte layout; no vendor code reused.';

const LHT65: ModelDefinition<Lht65Telemetry, 'LHT65' | 'LHT65N'> = {
  vendor: 'Dragino',
  model: 'LHT65',
  aliases: ['LHT65N'],
  description: 'Temperature and humidity sensor with external probe input (DS18B20, ADC, counter, interrupt)',
  fPort: 2,
  source: SOURCE,
  keys: LHT65_KEYS,
  decode: decodeLht65,
};

export const DRAGINO_MODELS = [LHT65] as const;
