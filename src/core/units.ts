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
  AMPERE_HOUR: 'Ah',
  VOLT: 'V',
  WATT: 'W',
  KILOWATT_HOUR: 'kWh',
  // concentration
  PPM: 'ppm',
  PPB: 'ppb',
  MICROGRAM_PER_M3: 'µg/m³',
  MILLIGRAM_PER_M3: 'mg/m³',
  MICROSIEMENS_PER_CM: 'µS/cm',
  // acoustics
  DECIBEL: 'dB',
  // light
  LUX: 'lx',
  // angle
  DEGREE: '°',
  // counting, time
  COUNT: 'count',
  MINUTE: 'min',
  // dimensionless / index
  INDEX: 'index',
  // raw count, scale configured out of band; only on `*_raw` and documented raw keys
  RAW: 'raw',
} as const;

export type Unit = (typeof Unit)[keyof typeof Unit];
