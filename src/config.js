import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function envFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function loadRoleMap(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Role map at ${filePath} must be a JSON object`);
  }
  const map = {};
  for (const [email, entry] of Object.entries(parsed)) {
    map[String(email).trim().toLowerCase()] = entry;
  }
  return map;
}

function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  const file = path.join(projectRoot, 'data', '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.warn('SESSION_SECRET is not set. A local secret was written to data/.session-secret');
  return secret;
}

export function loadConfig() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const googleConfigured = Boolean(googleClientId && googleClientSecret);
  const localFlag = envFlag(process.env.ALLOW_LOCAL_AUTH);
  const roleMapPath = process.env.ROLE_MAP_PATH
    ? path.resolve(process.env.ROLE_MAP_PATH)
    : path.join(projectRoot, 'config', 'roles.json');

  return {
    port: Number(process.env.PORT || 47231),
    host: process.env.HOST || '0.0.0.0',
    dbPath: process.env.DB_PATH
      ? path.resolve(process.env.DB_PATH)
      : path.join(projectRoot, 'data', 'ptc.sqlite'),
    schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
    publicDir: path.join(projectRoot, 'public'),
    sessionSecret: sessionSecret(),
    timeZone: process.env.APP_TIMEZONE || 'Asia/Bangkok',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    localAuth: localFlag === null ? !googleConfigured : localFlag,
    roleMap: loadRoleMap(roleMapPath),
    google: {
      configured: googleConfigured,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
      hostedDomain: process.env.GOOGLE_HOSTED_DOMAIN || '',
    },
    psapi: {
      baseUrl: process.env.PSAPI_BASE_URL || '',
      clientId: process.env.PSAPI_CLIENT_ID || '',
      clientSecret: process.env.PSAPI_CLIENT_SECRET || '',
      teachersPath: process.env.PSAPI_TEACHERS_PATH || '/ws/schema/table/teachers',
    },
  };
}
