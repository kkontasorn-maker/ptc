const ROLES = new Set(['it_admin', 'front_office', 'teacher', 'parent']);

/** Highest priority first: it_admin > front_office > teacher (> parent). */
export const ROLE_PRIORITY = ['it_admin', 'front_office', 'teacher', 'parent'];

export function normalizeRolesEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  let roles;
  if (Array.isArray(entry.roles)) {
    roles = entry.roles.map((role) => String(role).trim()).filter(Boolean);
  } else if (typeof entry.role === 'string' && entry.role.trim()) {
    roles = [entry.role.trim()];
  } else {
    return null;
  }
  const unique = [];
  for (const role of roles) {
    if (!ROLES.has(role)) continue;
    if (!unique.includes(role)) unique.push(role);
  }
  if (!unique.length) return null;
  const teacherid = entry.teacherid == null ? null : String(entry.teacherid).trim() || null;
  if (unique.includes('teacher') && !teacherid) return null;
  return { roles: unique, teacherid: unique.includes('teacher') ? teacherid : null };
}

export function pickActiveRole(roles) {
  if (!Array.isArray(roles) || !roles.length) return null;
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return role;
  }
  return roles[0];
}

/**
 * Resolve an account from the role map. Does not pick activeRole from a session —
 * use resolveSessionUser for that.
 */
export function resolveAccount(email, roleMap) {
  const key = String(email || '').trim().toLowerCase();
  const entry = normalizeRolesEntry(roleMap?.[key]);
  if (!entry) return null;
  return {
    email: key,
    roles: entry.roles,
    teacherid: entry.teacherid,
  };
}

/**
 * Sign-in / session user. When activeRoleHint is omitted, picks the highest-priority
 * role present. When provided (from the session cookie), keeps it if still allowed.
 */
export function resolveRole(email, roleMap, activeRoleHint = null) {
  const account = resolveAccount(email, roleMap);
  if (!account) return null;
  const activeRole = account.roles.includes(activeRoleHint)
    ? activeRoleHint
    : pickActiveRole(account.roles);
  return sessionUser(account, activeRole);
}

export function sessionUser(account, activeRole) {
  return {
    email: account.email,
    roles: account.roles,
    activeRole,
    // Alias for clients that still read `role` until the switcher lands.
    role: activeRole,
    teacherid: account.teacherid,
  };
}

/** Build req.user from a signed session payload + current role map. */
export function resolveSessionUser(session, roleMap) {
  if (!session?.email) return null;
  const account = resolveAccount(session.email, roleMap);
  if (!account) return null;
  const sessionRoles = Array.isArray(session.roles)
    ? session.roles.filter((role) => account.roles.includes(role))
    : account.roles;
  const roles = sessionRoles.length ? sessionRoles : account.roles;
  const hint = typeof session.activeRole === 'string' ? session.activeRole : null;
  const activeRole = roles.includes(hint) ? hint : pickActiveRole(roles);
  return sessionUser({ ...account, roles }, activeRole);
}
