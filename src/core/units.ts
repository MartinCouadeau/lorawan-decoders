/**
 * Units and quantity kinds.
 *
 * The point of this module is that every vendor in this library emits the same
 * vocabulary. A Milesight EM400-TLD reporting millimetres and an Ellenex PLS2-L
 * reporting metres both end up as `kind: 'distance'` with an explicit unit, so a
 * consumer can convert without knowing which vendor produced the reading.
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
  PASCAL: 'Pa',
  BAR: 'bar',
  // electrical
  MILLIAMPERE: 'mA',
  VOLT: 'V',
  MILLIVOLT: 'mV',
  MICROAMPERE: 'µA',
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
  // configured out of band (see Ellenex).
  RAW: 'raw',
} as const;

export type Unit = (typeof Unit)[keyof typeof Unit];

/**
 * What a measurement *is*, independent of the unit it arrived in. Consumers key
 * dashboards and alarm rules off this rather than off vendor field names.
 */
export type QuantityKind =
  | 'battery'
  | 'temperature'
  | 'humidity'
  | 'distance'
  | 'level'
  | 'pressure'
  | 'differential_pressure'
  | 'current'
  | 'voltage'
  | 'illuminance'
  | 'gas_concentration'
  | 'particulate'
  | 'co2'
  | 'tvoc'
  | 'sound_level'
  | 'angle'
  | 'occupancy'
  | 'counter'
  | 'state'
  | 'event'
  | 'unknown';
