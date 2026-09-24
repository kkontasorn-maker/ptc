import { safePhotoUrl } from './present.js';
import { chunkSlots } from './slots.js';

function roomFor(assignment, teacherRoom) {
  if (typeof assignment.room_override === 'string' && assignment.room_override.trim()) {
    return assignment.room_override;
  }
  return teacherRoom || null;
}

function matchingBookings(bookings, { staffId, serviceId, studentId, parentEmail, own }) {
  return bookings.filter((booking) => booking.staff_id === staffId
    && booking.service_id === serviceId
    && booking.student_powerschool_id === studentId
    && (own ? booking.parent_email === parentEmail : booking.parent_email !== parentEmail));
}

function alreadyBooked(bookings, key) {
  const matches = matchingBookings(bookings, { ...key, own: true });
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id - b.id);
  const first = matches[0];
  return {
    booking_id: first.id,
    start_time: first.start_time,
    end_time: first.end_time,
  };
}

function bookedByOtherGuardian(bookings, key) {
  const matches = matchingBookings(bookings, { ...key, own: false });
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id - b.id);
  const first = matches[0];
  return {
    relationship: first.parent_relationship,
    start_time: first.start_time,
    end_time: first.end_time,
  };
}

export function buildParentView({
  students,
  schedule,
  bookableBlocks,
  bookings,
  parentEmail,
  timeZone,
}) {
  const blocksByStaff = new Map();
  for (const block of bookableBlocks) {
    const list = blocksByStaff.get(block.staff_id) || [];
    list.push(block);
    blocksByStaff.set(block.staff_id, list);
  }

  const children = students.map((student) => {
    const teacherRoom = new Map(
      student.teachers.map((teacher) => [teacher.powerschool_teacher_id, teacher.room || null]),
    );
    const teachers = [];
    for (const assignment of schedule) {
      if (!teacherRoom.has(assignment.powerschool_teacher_id)) continue;
      const staffBookings = bookings.filter((booking) => booking.staff_id === assignment.staff_id);
      teachers.push({
        staff_id: assignment.staff_id,
        display_name: assignment.display_name,
        photo_url: safePhotoUrl(assignment.photo_url),
        room: roomFor(assignment, teacherRoom.get(assignment.powerschool_teacher_id)),
        service_id: assignment.service_id,
        slot_duration_minutes: assignment.slot_duration_minutes,
        slots: chunkSlots(
          blocksByStaff.get(assignment.staff_id) || [],
          assignment.slot_duration_minutes,
          staffBookings,
          timeZone,
        ),
        already_booked: alreadyBooked(bookings, {
          staffId: assignment.staff_id,
          serviceId: assignment.service_id,
          studentId: student.student_powerschool_id,
          parentEmail,
        }),
        booked_by_other_guardian: bookedByOtherGuardian(bookings, {
          staffId: assignment.staff_id,
          serviceId: assignment.service_id,
          studentId: student.student_powerschool_id,
          parentEmail,
        }),
      });
    }
    return {
      student_powerschool_id: student.student_powerschool_id,
      name: student.name,
      nickname: student.nickname,
      grade: student.grade,
      teachers,
    };
  });

  return { children };
}

export function presentChildren(students) {
  return {
    children: students.map((student) => ({
      student_powerschool_id: student.student_powerschool_id,
      name: student.name,
      nickname: student.nickname,
      grade: student.grade,
    })),
  };
}
