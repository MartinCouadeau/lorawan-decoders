import type { ModelDefinition } from '../../core/types.js';
import { decodeLht65 } from './lht65.js';

const SOURCE =
  'Dragino LHT65/LHT65N user manuals (wiki.dragino.com) and the Apache-2.0 TTN Device Repository ' +
  'entries. Implemented from the documented byte layout; no vendor code reused.';

export const DRAGINO_MODELS: readonly ModelDefinition[] = [
  {
    vendor: 'Dragino',
    model: 'LHT65',
    aliases: ['LHT65N'],
    description: 'Temperature and humidity sensor with external probe input (DS18B20, ADC, counter, interrupt)',
    fPort: 2,
    source: SOURCE,
    decode: decodeLht65,
  },
];
