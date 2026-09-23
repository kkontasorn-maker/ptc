const ROLES = new Set(['it_admin', 'front_office', 'teacher', 'parent']);

export function resolveRole(email, roleMap) {
  const key = String(email || '').trim().toLowerCase();
  const entry = roleMap?.[key];
  if (!entry || !ROLES.has(entry.role)) return null;
  if (entry.role === 'teacher') {
    const teacherid = entry.teacherid == null ? '' : String(entry.teacherid).trim();
    if (!teacherid) return null;
    return { email: key, role: 'teacher', teacherid };
  }
  return { email: key, role: entry.role, teacherid: null };
}
