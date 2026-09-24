import { UnprocessableError, ValidationError } from './errors.js';
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

export function validateRoomOverride(body) {
  const data = requireObject(body);
  assertAllowed(data, ['room_override']);
  const value = data.room_override;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('room_override must be a string or null', [
      { field: 'room_override', message: 'room_override must be a string or null' },
    ]);
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > 100) {
    throw new ValidationError('room_override must be 100 characters or fewer', [
      { field: 'room_override', message: 'room_override must be 100 characters or fewer' },
    ]);
  }
  return text;
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
  assertAllowed(data, ['start_time', 'end_time', 'block_type', 'confirm_override', 'reason']);
  const details = [];
  const range = readRange(data.start_time, data.end_time, details, timeZone);
  const blockType = readBlockType(data.block_type, details);
  if (details.length) fail(details);
  return { ...range, block_type: blockType };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value, field = 'email') {
  if (Array.isArray(value)) {
    throw new ValidationError('Email must be a single address', [{
      field,
      message: 'Email must be a single address',
    }]);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError('Email is required', [{ field, message: 'Email is required' }]);
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    throw new ValidationError('Enter a valid email address', [{
      field,
      message: 'Enter a valid email address',
    }]);
  }
  return email;
}

export function validateVerificationRequest(body) {
  const data = requireObject(body);
  assertAllowed(data, ['email']);
  return { email: normalizeEmail(data.email) };
}

export function validateVerificationConfirm(body) {
  const data = requireObject(body);
  assertAllowed(data, ['email', 'code']);
  const email = normalizeEmail(data.email);
  const details = [];
  let code;
  if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code.trim())) {
    details.push({ field: 'code', message: 'Enter the 6-digit code' });
  } else {
    code = data.code.trim();
  }
  if (details.length) fail(details);
  return { email, code };
}

const RELATIONSHIPS = new Set(['mother', 'father', 'guardian', 'other']);
const STUDENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readOptionalText(value, details, field, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    details.push({ field, message: `${label} must be text` });
    return undefined;
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > 200) {
    details.push({ field, message: `${label} must be 200 characters or fewer` });
    return undefined;
  }
  return text;
}

function readPositiveInt(value, details, field, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
    details.push({ field, message: `${label} must be a positive integer` });
    return undefined;
  }
  return value;
}

export function validateBookingCreate(body, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, [
    'parent_email',
    'parent_relationship',
    'parent_relationship_other',
    'parent_first_name',
    'parent_last_name',
    'picks',
  ]);
  const details = [];
  let parentEmail;
  try {
    parentEmail = normalizeEmail(data.parent_email, 'parent_email');
  } catch (error) {
    if (error instanceof ValidationError && error.details) details.push(...error.details);
    else throw error;
  }
  let relationship;
  if (typeof data.parent_relationship !== 'string' || !RELATIONSHIPS.has(data.parent_relationship)) {
    details.push({
      field: 'parent_relationship',
      message: 'Relationship must be mother, father, guardian, or other',
    });
  } else {
    relationship = data.parent_relationship;
  }
  const relationshipOther = readOptionalText(
    data.parent_relationship_other,
    details,
    'parent_relationship_other',
    'Relationship',
  );
  if (relationship === 'other' && !relationshipOther) {
    details.push({
      field: 'parent_relationship_other',
      message: 'Describe the relationship',
    });
  }
  const parentFirst = readOptionalText(data.parent_first_name, details, 'parent_first_name', 'First name');
  const parentLast = readOptionalText(data.parent_last_name, details, 'parent_last_name', 'Last name');
  const picks = [];
  if (!Array.isArray(data.picks) || data.picks.length === 0) {
    details.push({ field: 'picks', message: 'Choose at least one time' });
  } else {
    data.picks.forEach((pick, index) => {
      const field = `picks.${index}`;
      if (pick === null || typeof pick !== 'object' || Array.isArray(pick)) {
        details.push({ field, message: 'Each time must be an object' });
        return;
      }
      const extra = Object.keys(pick).filter((key) => ![
        'student_powerschool_id', 'service_id', 'staff_id', 'start_time', 'end_time',
      ].includes(key));
      if (extra.length) {
        details.push({ field, message: `Unknown field: ${extra[0]}` });
        return;
      }
      let studentId;
      if (typeof pick.student_powerschool_id !== 'string' || !STUDENT_ID.test(pick.student_powerschool_id)) {
        details.push({ field, message: 'Choose a student linked to this email' });
      } else {
        studentId = pick.student_powerschool_id;
      }
      const serviceId = readPositiveInt(pick.service_id, details, field, 'Service');
      const staffId = readPositiveInt(pick.staff_id, details, field, 'Teacher');
      const start = parseDateTime(pick.start_time, timeZone);
      const end = parseDateTime(pick.end_time, timeZone);
      if (!start || !end || start >= end) {
        details.push({ field, message: 'Choose an open time from the schedule' });
      }
      if (studentId && serviceId && staffId && start && end && start < end) {
        picks.push({
          student_powerschool_id: studentId,
          service_id: serviceId,
          staff_id: staffId,
          start_time: start,
          end_time: end,
        });
      }
    });
  }
  if (details.length) fail(details);
  return {
    parent_email: parentEmail,
    parent_relationship: relationship,
    parent_relationship_other: relationship === 'other' ? relationshipOther : null,
    parent_first_name: parentFirst,
    parent_last_name: parentLast,
    picks,
  };
}

export function validateReschedule(body, timeZone) {
  const data = requireObject(body);
  assertAllowed(data, ['start_time', 'end_time']);
  const details = [];
  const start = readDateTime(data.start_time, details, 'start_time', timeZone);
  const end = readDateTime(data.end_time, details, 'end_time', timeZone);
  if (start && end && start >= end) {
    details.push({ field: 'end_time', message: 'End time must be after start time' });
  }
  if (details.length) fail(details);
  return { start_time: start, end_time: end };
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

const FALLBACK_TYPES = new Set(['line', 'phone', 'wechat', 'none']);

export function validateContactPreference(body) {
  const data = requireObject(body);
  assertAllowed(data, ['email', 'fallback_contact_type', 'fallback_contact_value']);
  const email = normalizeEmail(data.email);
  const type = typeof data.fallback_contact_type === 'string'
    ? data.fallback_contact_type.trim()
    : '';
  if (!FALLBACK_TYPES.has(type)) {
    throw new UnprocessableError('Fallback contact type must be line, phone, wechat, or none.');
  }
  const rawValue = data.fallback_contact_value == null ? '' : String(data.fallback_contact_value).trim();
  if (type === 'none') {
    return { email, fallback_contact_type: type, fallback_contact_value: null };
  }
  if (!rawValue) {
    throw new UnprocessableError('Enter a fallback contact.');
  }
  if (rawValue.length > 200) {
    throw new UnprocessableError('Fallback contact must be 200 characters or fewer.');
  }
  return { email, fallback_contact_type: type, fallback_contact_value: rawValue };
}
