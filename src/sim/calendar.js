// The calendar and the sun: pure functions of world time t (seconds, see time.js) and a site
// { latitudeDeg }. No state; the weather system and the renderer both call these.
//
// The year has 365 days and the 12 real months. START_T stays the zero point of world time;
// the calendar adds START_DAY_OF_YEAR so that a new world opens on a spring morning (10 April).
// The clock is local mean solar time, so solar noon wanders by the equation of time (about
// +-16 minutes over the year), as it does on a sundial.

import { DAY, dayIndex, dayFraction } from './time.js';

export const DAYS_IN_YEAR = 365;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_START = MONTH_DAYS.reduce((a, d, i) => (a.push(i ? a[i - 1] + MONTH_DAYS[i - 1] : 0), a), []);
// day 0 of world time is 10 April (0-based day of year 99)
export const START_DAY_OF_YEAR = MONTH_START[3] + 9;

export const SOLAR_CONSTANT = 1361;          // W/m2, top of the atmosphere at 1 AU
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

const absDay = (t) => dayIndex(t) + START_DAY_OF_YEAR;
export const dayOfYear = (t) => ((absDay(t) % DAYS_IN_YEAR) + DAYS_IN_YEAR) % DAYS_IN_YEAR;   // 0..364
export const yearIndex = (t) => Math.floor(absDay(t) / DAYS_IN_YEAR);                         // 0 = the first year
export const monthOf = (doy) => { let m = 11; while (MONTH_START[m] > doy) m--; return m; };   // 0..11
export const dayOfMonth = (doy) => doy - MONTH_START[monthOf(doy)] + 1;                        // 1..31

// Meteorological seasons of the northern hemisphere (spring = March to May); flipped south of the equator.
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
export function season(t, site) {
  let k = Math.floor(((monthOf(dayOfYear(t)) + 1) % 12) / 3);
  if (site && site.latitudeDeg < 0) k = (k + 2) % 4;
  return SEASONS[k];
}
export function dateText(t) {
  const d = dayOfYear(t);
  return dayOfMonth(d) + ' ' + MONTHS[monthOf(d)] + ', year ' + (yearIndex(t) + 1);
}

// Solar geometry (Spencer 1971 series for declination, equation of time and the Earth-Sun distance).
// gamma is the fractional year in radians, including the time of day.
function orbit(t) {
  const g = (TAU / DAYS_IN_YEAR) * (dayOfYear(t) + dayFraction(t) - 0.5);
  const c1 = Math.cos(g), s1 = Math.sin(g), c2 = Math.cos(2 * g), s2 = Math.sin(2 * g), c3 = Math.cos(3 * g), s3 = Math.sin(3 * g);
  return {
    decl: 0.006918 - 0.399912 * c1 + 0.070257 * s1 - 0.006758 * c2 + 0.000907 * s2 - 0.002697 * c3 + 0.00148 * s3,
    eotMin: 229.18 * (0.000075 + 0.001868 * c1 - 0.032077 * s1 - 0.014615 * c2 - 0.040849 * s2),
    e0: 1.00011 + 0.034221 * c1 + 0.00128 * s1 + 0.000719 * c2 + 0.000077 * s2,   // (r0 / r)^2
  };
}
export const solarDeclinationRad = (t) => orbit(t).decl;

// Sun position. Elevation above the horizon (no refraction) and azimuth clockwise from north.
export function sunPosition(t, site) {
  const o = orbit(t), phi = site.latitudeDeg * RAD;
  const solarHours = dayFraction(t) * 24 + o.eotMin / 60;
  const H = (solarHours - 12) * 15 * RAD;                           // hour angle, negative in the morning
  const sinEl = Math.sin(phi) * Math.sin(o.decl) + Math.cos(phi) * Math.cos(o.decl) * Math.cos(H);
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const east = -Math.cos(o.decl) * Math.sin(H);
  const north = Math.cos(phi) * Math.sin(o.decl) - Math.sin(phi) * Math.cos(o.decl) * Math.cos(H);
  let azimuthRad = Math.atan2(east, north);
  if (azimuthRad < 0) azimuthRad += TAU;
  return { elevationRad, azimuthRad };
}

// The sun's hour angle (radians, negative in the morning), by local solar time with the equation of time: with the
// sun's right ascension it gives the sidereal time, which sets the stars (the renderer's night sky).
export function solarHourAngleRad(t) {
  const o = orbit(t);
  return ((dayFraction(t) * 24 + o.eotMin / 60) - 12) * 15 * RAD;
}
// days since world time 0 began, counted from 1 January of the first year (for the moon's phase and the stars)
export const absoluteDays = (t) => absDay(t) + dayFraction(t);

// Sunrise and sunset as the almanac defines them: the upper limb on the horizon, with refraction
// (centre of the disc at -0.833 degrees). Clock hours of the day containing t.
const H0_ALT = -0.833 * RAD;
function halfDayRad(o, phi) {
  const c = (Math.sin(H0_ALT) - Math.sin(phi) * Math.sin(o.decl)) / (Math.cos(phi) * Math.cos(o.decl));
  return c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);             // polar day / polar night
}
export function sunTimes(t, site) {
  const noonT = t - dayFraction(t) * DAY + DAY / 2;                  // evaluate the orbit at noon of this day
  const o = orbit(noonT), h0 = halfDayRad(o, site.latitudeDeg * RAD) / (15 * RAD);
  const solarNoonH = 12 - o.eotMin / 60;
  return { sunriseH: solarNoonH - h0, sunsetH: solarNoonH + h0, solarNoonH, dayLengthH: 2 * h0 };
}
export const dayLengthHours = (t, site) => sunTimes(t, site).dayLengthH;

// Clear-sky irradiance on the ground, W/m2.
//   air mass: Kasten and Young (1989)
//   direct normal: Meinel and Meinel (1976), DNI = I0 * 0.7^(AM^0.678), sea level, average clear air
//   diffuse: Liu and Jordan (1960), diffuse transmittance = 0.271 - 0.294 * direct transmittance
export function airMass(elevationRad) {
  if (elevationRad <= 0) return Infinity;
  const zDeg = 90 - elevationRad / RAD;
  return 1 / (Math.cos(zDeg * RAD) + 0.50572 * Math.pow(96.07995 - zDeg, -1.6364));
}
export function clearSkyIrradiance(t, site) {
  const { elevationRad } = sunPosition(t, site);
  if (elevationRad <= 0) return { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 };
  const I0 = SOLAR_CONSTANT * orbit(t).e0, cosZ = Math.sin(elevationRad);
  const tauB = Math.pow(0.7, Math.pow(airMass(elevationRad), 0.678));
  const directNormalWm2 = I0 * tauB;
  const diffuseWm2 = I0 * cosZ * Math.max(0, 0.271 - 0.294 * tauB);
  return { directNormalWm2, diffuseWm2, globalHorizontalWm2: directNormalWm2 * cosZ + diffuseWm2 };
}

// Daily mean insolation at the top of the atmosphere on a horizontal surface, W/m2 (no refraction).
// Used by the weather system for the seasonal temperature cycle.
export function dailyInsolationTOA(doy, latitudeDeg) {
  const o = orbit((doy - START_DAY_OF_YEAR) * DAY + DAY / 2), phi = latitudeDeg * RAD;
  const c = -Math.tan(phi) * Math.tan(o.decl);
  const h0 = c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
  return (SOLAR_CONSTANT * o.e0 / Math.PI) * (h0 * Math.sin(phi) * Math.sin(o.decl) + Math.cos(phi) * Math.cos(o.decl) * Math.sin(h0));
}
