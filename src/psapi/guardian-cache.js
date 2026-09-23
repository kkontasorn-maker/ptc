const GUARDIAN_CACHE_MS = 5 * 60 * 1000;
const caches = new WeakMap();

function cacheFor(psapi) {
  let cache = caches.get(psapi);
  if (!cache) {
    cache = new Map();
    caches.set(psapi, cache);
  }
  return cache;
}

export function clearGuardianCache(psapi) {
  caches.delete(psapi);
}

export async function guardianStudents(psapi, email, now = Date.now()) {
  const cache = cacheFor(psapi);
  const hit = cache.get(email);
  if (hit && hit.expires > now) return hit.students;
  const result = await psapi.studentsForGuardian(email);
  const students = Array.isArray(result?.students) ? result.students : [];
  cache.set(email, { expires: now + GUARDIAN_CACHE_MS, students });
  return students;
}
