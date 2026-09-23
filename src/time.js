const DEFAULT_ZONE = 'Asia/Bangkok';

function part(parts, type) {
  const value = parts.find((item) => item.type === type)?.value ?? '';
  if (type === 'hour' && value === '24') return '00';
  return value;
}

export function zoneOffsetMinutes(date, timeZone = DEFAULT_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const asUtc = Date.UTC(
    Number(part(parts, 'year')),
    Number(part(parts, 'month')) - 1,
    Number(part(parts, 'day')),
    Number(part(parts, 'hour')),
    Number(part(parts, 'minute')),
    Number(part(parts, 'second')),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const mins = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}`;
}

export function formatInZone(date, timeZone = DEFAULT_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}T${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')}${formatOffset(zoneOffsetMinutes(date, timeZone))}`;
}

export function todayInZone(now = new Date(), timeZone = DEFAULT_ZONE) {
  return formatInZone(now, timeZone).slice(0, 10);
}

function calendarValid(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

function wallTimeToDate(year, month, day, hour, minute, second, timeZone) {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = zoneOffsetMinutes(new Date(wallAsUtc), timeZone);
  let utc = wallAsUtc - offset * 60000;
  const corrected = zoneOffsetMinutes(new Date(utc), timeZone);
  if (corrected !== offset) {
    offset = corrected;
    utc = wallAsUtc - offset * 60000;
  }
  return new Date(utc);
}

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!calendarValid(year, month, day, 0, 0, 0)) return null;
  return value;
}

export function parseDateTime(value, timeZone = DEFAULT_ZONE) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const naive = input.match(NAIVE);
  const offset = input.match(WITH_OFFSET);
  const match = offset || naive;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  if (!calendarValid(year, month, day, hour, minute, second)) return null;

  const date = offset
    ? new Date(input)
    : wallTimeToDate(year, month, day, hour, minute, second, timeZone);
  if (Number.isNaN(date.getTime())) return null;
  return formatInZone(date, timeZone);
}

export function formatCutoffMessage(cutoffAt, timeZone = DEFAULT_ZONE) {
  const date = new Date(cutoffAt);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const day = part(parts, 'day');
  const month = part(parts, 'month');
  const year = part(parts, 'year');
  const hour = part(parts, 'hour').padStart(2, '0');
  const minute = part(parts, 'minute').padStart(2, '0');
  return `Changes closed ${day} ${month} ${year} at ${hour}:${minute}`;
}

/**
 * Event.status is not stored.
 *
 * TODO(spec-gap): §2 says draft | upcoming | past is derived from event_date.
 * The design note says compare event_date and cutoff_at to now. Neither says
 * which comparison yields draft versus upcoming, or whether is_open_for_booking
 * participates. cutoff_at locks changes (§5.3); it does not make a conference
 * past before event_date.
 *
 * Reading used until that is decided:
 * - past: event_date is before today in the school timezone
 * - draft: the conference day has not passed and booking is not open
 * - upcoming: the conference day has not passed and booking is open
 */
export function computeEventStatus(event, now = new Date(), timeZone = DEFAULT_ZONE) {
  const today = todayInZone(now, timeZone);
  if (event.event_date < today) return 'past';
  if (!event.is_open_for_booking) return 'draft';
  return 'upcoming';
}

export function isPastCutoff(cutoffAt, now = new Date()) {
  if (!cutoffAt) return false;
  const cutoff = Date.parse(cutoffAt);
  if (Number.isNaN(cutoff)) return false;
  return now.getTime() > cutoff;
}
