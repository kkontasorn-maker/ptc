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

function readSchoolId(value, details, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) {
      details.push({ field: 'school_id', message: 'school_id must be a positive integer or null' });
    }
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
    details.push({ field: 'school_id', message: 'school_id must be a positive integer or null' });
    return undefined;
  }
  return value;
}

function readBufferMinutes(value, details, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      details.push({
        field: 'buffer_minutes',
        message: 'Buffer minutes must be a whole number of minutes from 0 upward',
      });
      return undefined;
    }
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    details.push({
      field: 'buffer_minutes',
      message: 'Buffer minutes must be a whole number of minutes from 0 upward',
    });
    return undefined;
  }
  return value;
}

export function validateServiceCreate(body) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'slot_duration_minutes', 'school_id', 'buffer_minutes']);
  const details = [];
  const name = readName(data.name, details);
  const duration = readDuration(data.slot_duration_minutes, details);
  const schoolId = Object.prototype.hasOwnProperty.call(data, 'school_id')
    ? readSchoolId(data.school_id, details)
    : null;
  const bufferMinutes = Object.prototype.hasOwnProperty.call(data, 'buffer_minutes')
    ? readBufferMinutes(data.buffer_minutes, details, { required: true })
    : 0;
  if (details.length) fail(details);
  return {
    name,
    slot_duration_minutes: duration,
    school_id: schoolId,
    buffer_minutes: bufferMinutes,
  };
}

export function validateServicePatch(body) {
  const data = requireObject(body);
  assertAllowed(data, ['name', 'slot_duration_minutes', 'school_id', 'buffer_minutes', 'active']);
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
  if (Object.prototype.hasOwnProperty.call(data, 'school_id')) {
    const schoolId = readSchoolId(data.school_id, details);
    if (schoolId !== undefined) patch.school_id = schoolId;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'buffer_minutes')) {
    const bufferMinutes = readBufferMinutes(data.buffer_minutes, details, { required: true });
    if (bufferMinutes !== undefined) patch.buffer_minutes = bufferMinutes;
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
    'custom_field_values',
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
  const customFieldValues = readCustomFieldValues(data.custom_field_values, details);
  if (details.length) fail(details);
  return {
    parent_email: parentEmail,
    parent_relationship: relationship,
    parent_relationship_other: relationship === 'other' ? relationshipOther : null,
    parent_first_name: parentFirst,
    parent_last_name: parentLast,
    picks,
    custom_field_values: customFieldValues,
  };
}

function readCustomFieldValues(raw, details) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    details.push({
      field: 'custom_field_values',
      message: 'custom_field_values must be an array',
    });
    return [];
  }
  const values = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    const field = `custom_field_values.${index}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      details.push({ field, message: 'Each custom field value must be an object' });
      return;
    }
    const extra = Object.keys(item).filter((key) => !['field_id', 'value'].includes(key));
    if (extra.length) {
      details.push({ field, message: `Unknown field: ${extra[0]}` });
      return;
    }
    const fieldId = readPositiveInt(item.field_id, details, field, 'Custom field');
    if (typeof item.value !== 'string') {
      details.push({ field, message: 'Value must be a string of 500 characters or fewer' });
      return;
    }
    if (item.value.length > 500) {
      details.push({ field, message: 'Value must be 500 characters or fewer' });
      return;
    }
    if (fieldId) {
      if (seen.has(fieldId)) {
        details.push({ field, message: 'Each custom field may be answered only once' });
        return;
      }
      seen.add(fieldId);
      values.push({ field_id: fieldId, value: item.value });
    }
  });
  return values;
}

export function validateCustomFieldCreate(body) {
  const data = requireObject(body);
  assertAllowed(data, ['label', 'required', 'position']);
  const details = [];
  const label = readName(data.label, details, 'label', 'Label');
  let required = false;
  if (Object.prototype.hasOwnProperty.call(data, 'required')) {
    if (typeof data.required !== 'boolean') {
      details.push({ field: 'required', message: 'Required must be true or false' });
    } else {
      required = data.required;
    }
  }
  const position = readPosition(data.position, details, false);
  if (details.length) fail(details);
  const result = { label, required };
  if (position !== undefined) result.position = position;
  return result;
}

export function validateCustomFieldPatch(body) {
  const data = requireObject(body);
  assertAllowed(data, ['label', 'required', 'position']);
  const details = [];
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'label')) {
    const label = readName(data.label, details, 'label', 'Label');
    if (label) patch.label = label;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'required')) {
    if (typeof data.required !== 'boolean') {
      details.push({ field: 'required', message: 'Required must be true or false' });
    } else {
      patch.required = data.required;
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'position')) {
    const position = readPosition(data.position, details, true);
    if (position !== undefined) patch.position = position;
  }
  if (!details.length && Object.keys(patch).length === 0) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  if (details.length) fail(details);
  return patch;
}

export function validateCustomFieldReorder(body) {
  return validateLandingBlockReorder(body);
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

const LANDING_BLOCK_TYPES = new Set(['header', 'login_tiles', 'announcement', 'rich_text']);
const ANNOUNCEMENT_TONES = new Set(['info', 'warning']);
const HTML_LIKE = /<\/?[a-z][\s\S]*>/i;
const URL_LIKE = /https?:\/\/|www\.|href\s*=/i;

function readRequiredText(value, details, field, label, { max = 500 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    details.push({ field, message: `${label} is required` });
    return undefined;
  }
  const text = value.trim();
  if (text.length > max) {
    details.push({ field, message: `${label} must be ${max} characters or fewer` });
    return undefined;
  }
  return text;
}

function readLogoUrl(value, details) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    details.push({ field: 'logo_url', message: 'Logo URL must be an http or https link, or null' });
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    details.push({ field: 'logo_url', message: 'Logo URL must be 500 characters or fewer' });
    return undefined;
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    details.push({ field: 'logo_url', message: 'Logo URL must be an http or https link, or null' });
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    details.push({ field: 'logo_url', message: 'Logo URL must be an http or https link, or null' });
    return undefined;
  }
  return trimmed;
}

function assertNoUrls(text, details, field, label) {
  if (text == null) return;
  if (URL_LIKE.test(text)) {
    details.push({ field, message: `${label} cannot include links` });
  }
}

function assertNoHtml(text, details, field, label) {
  if (text == null) return;
  if (HTML_LIKE.test(text)) {
    details.push({ field, message: `${label} cannot include HTML` });
  }
}

function requireContentObject(content, details) {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    details.push({ field: 'content', message: 'Content must be a JSON object' });
    return null;
  }
  return content;
}

function assertContentKeys(content, keys, details) {
  const extra = Object.keys(content).filter((key) => !keys.includes(key));
  if (extra.length) {
    details.push({ field: 'content', message: `Unknown content field: ${extra[0]}` });
  }
}

export function validateLandingBlockContent(blockType, content) {
  const details = [];
  const data = requireContentObject(content, details);
  if (!data) fail(details);

  if (blockType === 'header') {
    assertContentKeys(data, ['school_name', 'welcome_text', 'logo_url'], details);
    const schoolName = readRequiredText(data.school_name, details, 'school_name', 'School name', { max: 200 });
    const welcomeText = readRequiredText(data.welcome_text, details, 'welcome_text', 'Welcome text', { max: 500 });
    const logoUrl = Object.prototype.hasOwnProperty.call(data, 'logo_url')
      ? readLogoUrl(data.logo_url, details)
      : null;
    if (details.length) fail(details);
    return { school_name: schoolName, welcome_text: welcomeText, logo_url: logoUrl };
  }

  if (blockType === 'login_tiles') {
    assertContentKeys(data, [
      'parent_label', 'parent_description', 'teacher_label', 'teacher_description',
    ], details);
    const parentLabel = readRequiredText(data.parent_label, details, 'parent_label', 'Parent label', { max: 100 });
    const parentDescription = readRequiredText(
      data.parent_description, details, 'parent_description', 'Parent description', { max: 300 },
    );
    const teacherLabel = readRequiredText(data.teacher_label, details, 'teacher_label', 'Teacher label', { max: 100 });
    const teacherDescription = readRequiredText(
      data.teacher_description, details, 'teacher_description', 'Teacher description', { max: 300 },
    );
    assertNoUrls(parentLabel, details, 'parent_label', 'Parent label');
    assertNoUrls(parentDescription, details, 'parent_description', 'Parent description');
    assertNoUrls(teacherLabel, details, 'teacher_label', 'Teacher label');
    assertNoUrls(teacherDescription, details, 'teacher_description', 'Teacher description');
    if (details.length) fail(details);
    return {
      parent_label: parentLabel,
      parent_description: parentDescription,
      teacher_label: teacherLabel,
      teacher_description: teacherDescription,
    };
  }

  if (blockType === 'announcement') {
    assertContentKeys(data, ['message', 'tone'], details);
    const message = readRequiredText(data.message, details, 'message', 'Message', { max: 1000 });
    assertNoHtml(message, details, 'message', 'Message');
    let tone;
    if (typeof data.tone !== 'string' || !ANNOUNCEMENT_TONES.has(data.tone)) {
      details.push({ field: 'tone', message: 'Tone must be info or warning' });
    } else {
      tone = data.tone;
    }
    if (details.length) fail(details);
    return { message, tone };
  }

  if (blockType === 'rich_text') {
    assertContentKeys(data, ['text'], details);
    const text = readRequiredText(data.text, details, 'text', 'Text', { max: 5000 });
    assertNoHtml(text, details, 'text', 'Text');
    if (details.length) fail(details);
    return { text };
  }

  throw new ValidationError('Unknown block type', [
    { field: 'block_type', message: 'Unknown block type' },
  ]);
}

function readPosition(value, details, required = false) {
  if (value === undefined || value === null) {
    if (required) {
      details.push({ field: 'position', message: 'Position must be a whole number from 0 upward' });
    }
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    details.push({ field: 'position', message: 'Position must be a whole number from 0 upward' });
    return undefined;
  }
  return value;
}

function readVisible(value, details) {
  if (typeof value !== 'boolean') {
    details.push({ field: 'visible', message: 'Visible must be true or false' });
    return undefined;
  }
  return value;
}

export function validateLandingBlockCreate(body) {
  const data = requireObject(body);
  assertAllowed(data, ['block_type', 'content', 'position', 'visible']);
  const details = [];
  let blockType;
  if (typeof data.block_type !== 'string' || !LANDING_BLOCK_TYPES.has(data.block_type)) {
    details.push({
      field: 'block_type',
      message: 'Block type must be header, login_tiles, announcement, or rich_text',
    });
  } else {
    blockType = data.block_type;
  }
  const position = readPosition(data.position, details, false);
  let visible = true;
  if (Object.prototype.hasOwnProperty.call(data, 'visible')) {
    const parsed = readVisible(data.visible, details);
    if (parsed !== undefined) visible = parsed;
  }
  let content;
  if (blockType) {
    try {
      content = validateLandingBlockContent(blockType, data.content);
    } catch (error) {
      if (error instanceof ValidationError && error.details) {
        details.push(...error.details);
      } else {
        throw error;
      }
    }
  } else if (!Object.prototype.hasOwnProperty.call(data, 'content')) {
    details.push({ field: 'content', message: 'Content must be a JSON object' });
  }
  if (details.length) fail(details);
  const result = { block_type: blockType, content, visible };
  if (position !== undefined) result.position = position;
  return result;
}

export function validateLandingBlockPatch(body, blockType) {
  const data = requireObject(body);
  assertAllowed(data, ['content', 'visible', 'position']);
  const details = [];
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'content')) {
    try {
      patch.content = validateLandingBlockContent(blockType, data.content);
    } catch (error) {
      if (error instanceof ValidationError && error.details) {
        details.push(...error.details);
      } else {
        throw error;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'visible')) {
    const visible = readVisible(data.visible, details);
    if (visible !== undefined) patch.visible = visible;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'position')) {
    const position = readPosition(data.position, details, true);
    if (position !== undefined) patch.position = position;
  }
  if (!details.length && Object.keys(patch).length === 0) {
    details.push({ field: 'body', message: 'No fields to update' });
  }
  if (details.length) fail(details);
  return patch;
}

export function validateLandingBlockReorder(body) {
  const data = requireObject(body);
  assertAllowed(data, ['ordered_ids']);
  if (!Array.isArray(data.ordered_ids) || data.ordered_ids.length === 0) {
    throw new ValidationError('ordered_ids must be a non-empty array', [
      { field: 'ordered_ids', message: 'ordered_ids must be a non-empty array' },
    ]);
  }
  const orderedIds = [];
  const seen = new Set();
  data.ordered_ids.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
      throw new ValidationError('Each ordered id must be a positive integer', [
        { field: `ordered_ids.${index}`, message: 'Each ordered id must be a positive integer' },
      ]);
    }
    if (seen.has(value)) {
      throw new ValidationError('ordered_ids must not contain duplicates', [
        { field: 'ordered_ids', message: 'ordered_ids must not contain duplicates' },
      ]);
    }
    seen.add(value);
    orderedIds.push(value);
  });
  return { ordered_ids: orderedIds };
}
