import { ConflictError, UnprocessableError } from './errors.js';
import { deliverConflictNotice } from './mail/mailer.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function readConfirmOverride(body) {
  if (!body || body.confirm_override !== true) return null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    throw new UnprocessableError('A reason is required to confirm this change.');
  }
  if (reason.length > 500) {
    throw new UnprocessableError('Reason must be 500 characters or fewer.');
  }
  return reason;
}

export function presentAffected(rows) {
  return rows.map((row) => ({
    id: row.id,
    student_name: row.student_name,
    parent_email: row.parent_email,
    start_time: row.start_time,
    end_time: row.end_time,
  }));
}

export function rejectIfStranded(rows, reason, message) {
  if (rows.length === 0 || reason) return;
  throw new ConflictError(message, presentAffected(rows));
}

export function formatConferenceDate(eventDate) {
  const [year, month, day] = String(eventDate || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(eventDate || '');
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export async function notifyStrandedParents({
  mail,
  teacherName,
  eventDate,
  rows,
  markNotified,
}) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.parent_email) || [];
    list.push(row);
    groups.set(row.parent_email, list);
  }
  const date = formatConferenceDate(eventDate);
  for (const [email, bookings] of groups) {
    try {
      const result = await deliverConflictNotice({
        mail,
        email,
        teacherName,
        combos: bookings.map((booking) => ({
          date,
          student: booking.student_name,
        })),
      });
      if (result.delivered) markNotified(bookings.map((booking) => booking.log_id));
    } catch (error) {
      console.error('Conflict notice could not be sent');
    }
  }
}
