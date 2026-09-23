import { computeEventStatus } from './time.js';

export function safePhotoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function presentEvent(event, timeZone, now = new Date()) {
  return {
    id: event.id,
    name: event.name,
    event_date: event.event_date,
    cutoff_at: event.cutoff_at,
    is_open_for_booking: event.is_open_for_booking,
    summary_sent_at: event.summary_sent_at,
    created_by: event.created_by,
    created_at: event.created_at,
    updated_at: event.updated_at,
    status: computeEventStatus(event, now, timeZone),
  };
}

export function presentStaffMember(member) {
  return {
    id: member.id,
    powerschool_teacher_id: member.powerschool_teacher_id,
    display_name: member.display_name,
    email: member.email,
    photo_url: safePhotoUrl(member.photo_url),
    active: member.active,
    room_override: Object.prototype.hasOwnProperty.call(member, 'room_override')
      ? member.room_override
      : undefined,
  };
}

export function presentService(service, staff = []) {
  return {
    id: service.id,
    event_id: service.event_id,
    name: service.name,
    slot_duration_minutes: service.slot_duration_minutes,
    created_at: service.created_at,
    updated_at: service.updated_at,
    staff: staff.map((member) => {
      const presented = presentStaffMember(member);
      if (presented.room_override === undefined) presented.room_override = null;
      return presented;
    }),
  };
}

export function presentMergedStaff(member) {
  return {
    id: member.id,
    powerschool_teacher_id: member.powerschool_teacher_id,
    display_name: member.display_name,
    email: member.email,
    photo_url: safePhotoUrl(member.photo_url),
    active: Boolean(member.active),
    synced: Boolean(member.synced),
    in_powerschool: Boolean(member.in_powerschool),
    powerschool_room: member.powerschool_room ?? null,
  };
}
