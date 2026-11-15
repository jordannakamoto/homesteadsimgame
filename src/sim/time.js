// Simulation time. One unit of sim time is one second of the homestead's world.
// The calendar (months, seasons, sun) is layered on top of this in the weather iteration.

export const TICK = 60;                 // seconds of world time per simulation tick
export const DAY = 86400;
export const HOUR = 3600;
export const START_T = 8 * HOUR + 600;  // a new world begins at 08:10 on day 1

export const dayFraction = (t) => (((t % DAY) + DAY) % DAY) / DAY;   // 0 = midnight, 0.5 = noon
export const dayIndex = (t) => Math.floor(t / DAY);                  // 0-based
export const hourOfDay = (t) => dayFraction(t) * 24;
export function clockText(t) {
  const m = Math.floor(dayFraction(t) * 1440 + 1e-6);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// The year can be shorter than a real one (a world option). Days stay 24 hours; the seasons, and
// everything that lives on a seasonal clock (plants, animals maturing, compost, soil warming), run
// faster by lifeScale = 365 / yearDays. Two clocks result:
//   t      clock time: the sun through the day, power, water, heat, daily chores
//   lifeT  seasonal time: where the year is, how old things are, how far a crop has grown
// calendarT joins them into one timestamp for the calendar functions: the date from lifeT, the
// time of day from t.
export const YEAR_DAYS_REAL = 365;
export const YEAR_DAY_CHOICES = [12, 20, 40, 120, 365];
export const calendarT = (t, lifeT) => Math.floor(lifeT / DAY) * DAY + (((t % DAY) + DAY) % DAY);
