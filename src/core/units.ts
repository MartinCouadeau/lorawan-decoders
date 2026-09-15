/** Unit strings. Which key carries which unit is in vocabulary.ts. */

export const Unit = {
  // temperature
  CELSIUS: '°C',
  // ratio
  PERCENT: '%',
  // distance
  MILLIMETRE: 'mm',
  METRE: 'm',
  // pressure
  KILOPASCAL: 'kPa',
  HECTOPASCAL: 'hPa',
  // electrical
  MILLIAMPERE: 'mA',
  VOLT: 'V',
  // concentration
  PPM: 'ppm',
  MICROGRAM_PER_M3: 'µg/m³',
  // acoustics
  DECIBEL: 'dB',
  // light
  LUX: 'lx',
  // angle
  DEGREE: '°',
  // counting
  COUNT: 'count',
  // dimensionless / index
  INDEX: 'index',
  // raw count, scale configured out of band; only on `*_raw` and documented raw keys
  RAW: 'raw',
} as const;

export type Unit = (typeof Unit)[keyof typeof Unit];
