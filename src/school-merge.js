export function mergeSchools(psSchools, localRows) {
  const localBySchoolId = new Map(localRows.map((row) => [row.powerschool_school_id, row]));
  const seen = new Set();
  const schools = [];

  for (const school of psSchools) {
    seen.add(school.powerschool_school_id);
    const local = localBySchoolId.get(school.powerschool_school_id);
    if (local) {
      schools.push({
        id: local.id,
        powerschool_school_id: local.powerschool_school_id,
        name: local.name,
        synced: true,
        in_powerschool: true,
      });
    } else {
      schools.push({
        id: null,
        powerschool_school_id: school.powerschool_school_id,
        name: school.name,
        synced: false,
        in_powerschool: true,
      });
    }
  }

  for (const local of localRows) {
    if (seen.has(local.powerschool_school_id)) continue;
    schools.push({
      id: local.id,
      powerschool_school_id: local.powerschool_school_id,
      name: local.name,
      synced: true,
      in_powerschool: false,
    });
  }

  schools.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    || (a.id ?? 0) - (b.id ?? 0));
  return schools;
}
