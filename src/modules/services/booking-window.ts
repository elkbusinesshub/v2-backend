/**
 * The bookable window offered to clients and enforced on booking creation:
 * tomorrow through tomorrow+4 (no same-day), on a fixed slot grid until
 * provider schedules exist.
 */
export const BOOKABLE_DAYS = 5;
export const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface BookableDate {
  day: number;
  weekday: string;
  date: Date;
}

export function upcomingDates(now = new Date()): BookableDate[] {
  return Array.from({ length: BOOKABLE_DAYS }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() + 1 + i);
    date.setHours(0, 0, 0, 0);
    return { day: date.getDate(), weekday: WEEKDAYS[date.getDay()]!, date };
  });
}

/**
 * Resolves a (day-of-month, "HH:MM") pick against the current window.
 * Returns null when the day is outside the window or the time is not a slot.
 */
export function resolveSlot(
  day: number,
  time: string,
  now = new Date(),
): { scheduledAt: Date; weekday: string } | null {
  if (!TIME_SLOTS.includes(time)) {
    return null;
  }
  const match = upcomingDates(now).find((d) => d.day === day);
  if (!match) {
    return null;
  }
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const scheduledAt = new Date(match.date);
  scheduledAt.setHours(hours, minutes, 0, 0);
  return { scheduledAt, weekday: match.weekday };
}
