import { guardianStudents } from './psapi/guardian-cache.js';

export const FALLBACK_LOCATION = 'NIS Elementary Building';

function overrideRoom(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

export async function resolveBookingRooms(psapi, rows) {
  const fromPowerSchool = new Map();
  const emails = [...new Set(rows.map((row) => row.parent_email))];
  for (const email of emails) {
    try {
      const students = await guardianStudents(psapi, email);
      for (const student of students) {
        for (const teacher of student.teachers || []) {
          const key = `${email}\n${student.student_powerschool_id}\n${teacher.powerschool_teacher_id}`;
          fromPowerSchool.set(key, teacher.room || null);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
  return rows.map((row) => {
    const key = `${row.parent_email}\n${row.student_powerschool_id}\n${row.powerschool_teacher_id}`;
    return overrideRoom(row.room_override) || fromPowerSchool.get(key) || null;
  });
}

export function locationLabel(room) {
  return room ? `Room ${room}` : FALLBACK_LOCATION;
}
