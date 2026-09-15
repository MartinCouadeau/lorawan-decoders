/**
 * Units.
 *
 * Every vendor in this library emits the same vocabulary: a Milesight
 * EM400-TLD and an Ellenex PLS2-L both report `distance` in millimetres, so a
 * consumer never needs to know which vendor produced a reading. The key → unit
 * table lives in vocabulary.ts.
 */

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
  // unknown scale — the device reported a raw number whose engineering unit is
  // configured out of band (see Ellenex). Only ever on a `*_raw` key.
  RAW: 'raw',
} as const;

export type Unit = (typeof Unit)[keyof typeof Unit];
