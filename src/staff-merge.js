export function mergeStaff(psTeachers, localRows) {
  const localByTeacherId = new Map(localRows.map((row) => [row.powerschool_teacher_id, row]));
  const seen = new Set();
  const staff = [];

  for (const teacher of psTeachers) {
    seen.add(teacher.powerschool_teacher_id);
    const local = localByTeacherId.get(teacher.powerschool_teacher_id);
    if (local) {
      staff.push({
        id: local.id,
        powerschool_teacher_id: local.powerschool_teacher_id,
        display_name: local.display_name,
        email: local.email,
        photo_url: local.photo_url,
        active: local.active,
        synced: true,
        in_powerschool: true,
        powerschool_room: teacher.room ?? null,
      });
    } else {
      staff.push({
        id: null,
        powerschool_teacher_id: teacher.powerschool_teacher_id,
        display_name: teacher.display_name,
        email: teacher.email,
        photo_url: teacher.photo_url ?? null,
        active: true,
        synced: false,
        in_powerschool: true,
        powerschool_room: teacher.room ?? null,
      });
    }
  }

  for (const local of localRows) {
    if (seen.has(local.powerschool_teacher_id)) continue;
    staff.push({
      id: local.id,
      powerschool_teacher_id: local.powerschool_teacher_id,
      display_name: local.display_name,
      email: local.email,
      photo_url: local.photo_url,
      active: local.active,
      synced: true,
      in_powerschool: false,
      powerschool_room: null,
    });
  }

  staff.sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
    || (a.id ?? 0) - (b.id ?? 0));
  return staff;
}
