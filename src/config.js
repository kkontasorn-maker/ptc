import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEmailAllowlist } from './mail/mailer.js';

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
  for (const [email, raw] of Object.entries(parsed)) {
    const key = String(email).trim().toLowerCase();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Role map entry for ${key} must be an object`);
    }
    let roles;
    if (Array.isArray(raw.roles)) {
      roles = raw.roles.map((role) => String(role).trim()).filter(Boolean);
    } else if (typeof raw.role === 'string' && raw.role.trim()) {
      // Accept legacy single-role entries and normalize to a one-item list.
      roles = [raw.role.trim()];
    } else {
      throw new Error(`Role map entry for ${key} must include a roles array`);
    }
    if (!roles.length) {
      throw new Error(`Role map entry for ${key} must include at least one role`);
    }
    const entry = { roles };
    if (Object.prototype.hasOwnProperty.call(raw, 'teacherid')) {
      entry.teacherid = raw.teacherid;
    }
    map[key] = entry;
  }
  return map;
}

function deliveryIssueStaleHours(value) {
  if (value == null || String(value).trim() === '') return 24;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return 24;
  return Math.floor(hours);
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
      studentsPath: process.env.PSAPI_STUDENTS_PATH || '/ws/schema/table/students',
    },
    mail: {
      configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim()),
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || 'conferences@nis.ac.th',
      allowlist: parseEmailAllowlist(process.env.EMAIL_ALLOWLIST),
    },
    webhook: {
      provider: (process.env.EMAIL_WEBHOOK_PROVIDER || '').trim().toLowerCase(),
      secret: process.env.EMAIL_WEBHOOK_SECRET || '',
    },
    deliveryIssueStaleHours: deliveryIssueStaleHours(process.env.DELIVERY_ISSUE_STALE_HOURS),
    exposeDevCode: process.env.NODE_ENV !== 'production'
      && !process.env.SMTP_HOST,
    summaryIntervalMs: process.env.SUMMARY_INTERVAL_MS == null || process.env.SUMMARY_INTERVAL_MS === ''
      ? 60_000
      : Number(process.env.SUMMARY_INTERVAL_MS),
  };
}
