import { ValidationError } from './errors.js';
import { parseDate, parseDateTime } from './time.js';

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body;
}

function assertAllowed(body, keys) {
  const extra = Object.keys(body).filter((key) => !keys.includes(key));
  if (extra.length === 0) return;
  throw new ValidationError(`Unknown field: ${extra[0]}`, extra.map((field) => ({
    field,
    message: 'This field cannot be set here',
  })));
}

function fail(details) {
  throw new ValidationError(details[0].message, details);
}

function readName(value, details, field = 'name', label = 'Name') {
  if (typeof value !== 'string' || !value.trim()) {
    details.push({ field, message: `${label} is required` });
    return undefined;
  }
  const name = value.trim();
  if (name.length > 200) {
    details.push({ field, message: `${label} must be 200 characters or fewer` });
    return undefined;
  }
  return name;
}

function readDate(value, details, field = 'event_date') {
  const date = parseDate(value);
  if (!date) {
    details.push({ field, message: 'Date must be YYYY-MM-DD' });
    return undefined;
  }
  return date;
}

function readDateTime(value, details, field, timeZone) {
  const parsed = parseDateTime(value, timeZone);
  if (!parsed) {
    details.push({ field, message: 'Time must be an ISO datetime' });
    return undefined;
  }
  return parsed;
}

function readDuration(value, details) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1440) {
    details.push({
      field: 'slot_duration_minutes',
      message: 'Slot duration must be a whole number of minutes from 1 to 1440',
    });
    return undefined;
  }
  return value;
}

export function parseRouteId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
  return id;
}

export function validateEventCreate(body, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'event_date', 'cutoff_at']);
  const details = [];
  const name = readName(data.name, details);
  const eventDate = readDate(data.event_date, details);
  let cutoffAt = null;
  if (data.cutoff_at != null) {
    cutoffAt = readDateTime(data.cutoff_at, details, 'cutoff_at', timeZone);
  }
  if (details.length) fail(details);
  return { name, event_date: eventDate, cutoff_at: cutoffAt };
}

export function validateEventPatch(body, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'event_date', 'cutoff_at', 'is_open_for_booking']);
  const details = [];
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    const name = readName(data.name, details);
    if (name) patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'event_date')) {
    const eventDate = readDate(data.event_date, details);
    if (eventDate) patch.event_date = eventDate;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'cutoff_at')) {
    if (data.cutoff_at === null) {
      patch.cutoff_at = null;
    } else {
      const cutoffAt = readDateTime(data.cutoff_at, details, 'cutoff_at', timeZone);
      if (cutoffAt) patch.cutoff_at = cutoffAt;
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'is_open_for_booking')) {
    if (typeof data.is_open_for_booking !== 'boolean') {
      details.push({ field: 'is_open_for_booking', message: 'Open for booking must be true or false' });
    } else {
      patch.is_open_for_booking = data.is_open_for_booking ? 1 : 0;
    }
  }
  if (!details.length && Object.keys(patch).length === 0) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  if (details.length) fail(details);
  return patch;
}

export function validateServiceCreate(body) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'slot_duration_minutes']);
  const details = [];
  const name = readName(data.name, details);
  const duration = readDuration(data.slot_duration_minutes, details);
  if (details.length) fail(details);
  return { name, slot_duration_minutes: duration };
}

export function validateServicePatch(body) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'slot_duration_minutes']);
  const details = [];
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    const name = readName(data.name, details);
    if (name) patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'slot_duration_minutes')) {
    const duration = readDuration(data.slot_duration_minutes, details);
    if (duration) patch.slot_duration_minutes = duration;
  }
  if (!details.length && Object.keys(patch).length === 0) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  if (details.length) fail(details);
  return patch;
}

function readPhoto(value, details) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    details.push({ field: 'photo_url', message: 'Photo URL must be an http or https link' });
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    details.push({ field: 'photo_url', message: 'Photo URL must be 500 characters or fewer' });
    return undefined;
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    details.push({ field: 'photo_url', message: 'Photo URL must be an http or https link' });
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    details.push({ field: 'photo_url', message: 'Photo URL must be an http or https link' });
    return undefined;
  }
  return trimmed;
}

export function validateStaffPatch(body) {
  const data = requireObject(body);
  assertAllowed(data, ['display_name', 'photo_url', 'active']);
  const details = [];
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'display_name')) {
    const name = readName(data.display_name, details, 'display_name', 'Display name');
    if (name) patch.display_name = name;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'photo_url')) {
    const photo = readPhoto(data.photo_url, details);
    if (photo !== undefined) patch.photo_url = photo;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'active')) {
    if (typeof data.active !== 'boolean') {
      details.push({ field: 'active', message: 'Active must be true or false' });
    } else {
      patch.active = data.active ? 1 : 0;
    }
  }
  if (!details.length && Object.keys(patch).length === 0) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  if (details.length) fail(details);
  return patch;
}

export function validateStaffAssign(body) {
  const data = requireObject(body);
  assertAllowed(data, ['staff_id']);
  if (typeof data.staff_id !== 'number' || !Number.isInteger(data.staff_id) || data.staff_id < 1) {
    throw new ValidationError('staff_id must be a positive integer', [
      { field: 'staff_id', message: 'staff_id must be a positive integer' },
    ]);
  }
  return { staff_id: data.staff_id };
}

export function validateLocalLogin(body) {
  const data = requireObject(body);
  assertAllowed(data, ['email']);
  if (typeof data.email !== 'string') {
    throw new ValidationError('Email is required', [
      { field: 'email', message: 'Email is required' },
    ]);
  }
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ValidationError('Enter a valid email address', [
      { field: 'email', message: 'Enter a valid email address' },
    ]);
  }
  return { email };
}

function readBlockType(value, details) {
  if (value !== 'bookable' && value !== 'break') {
    details.push({ field: 'block_type', message: 'Block type must be bookable or break' });
    return undefined;
  }
  return value;
}

function readRange(startValue, endValue, details, timeZone) {
  const start = readDateTime(startValue, details, 'start_time', timeZone);
  const end = readDateTime(endValue, details, 'end_time', timeZone);
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    details.push({ field: 'end_time', message: 'End time must be after start time' });
  }
  return { start_time: start, end_time: end };
}

export function validateAvailabilityCreate(body, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, ['start_time', 'end_time', 'block_type']);
  const details = [];
  const range = readRange(data.start_time, data.end_time, details, timeZone);
  const blockType = readBlockType(data.block_type, details);
  if (details.length) fail(details);
  return { ...range, block_type: blockType };
}

export function validateAvailabilityPatch(body, existing, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, ['start_time', 'end_time']);
  const details = [];
  const startValue = Object.prototype.hasOwnProperty.call(data, 'start_time')
    ? data.start_time
    : existing.start_time;
  const endValue = Object.prototype.hasOwnProperty.call(data, 'end_time')
    ? data.end_time
    : existing.end_time;
  if (!Object.prototype.hasOwnProperty.call(data, 'start_time')
    && !Object.prototype.hasOwnProperty.call(data, 'end_time')) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  const range = readRange(startValue, endValue, details, timeZone);
  if (details.length) fail(details);
  return range;
}
