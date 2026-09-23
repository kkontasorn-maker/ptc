import crypto from 'node:crypto';
import { DEVICE_MAX_AGE_MS } from '../auth/session.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_HOUR = 3;

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class VerificationRepository {
  constructor(db) {
    this.db = db;
    this.countRecentStmt = db.prepare(`
      SELECT COUNT(*) AS n FROM verification_codes
      WHERE email = ? AND created_at >= datetime('now', '-1 hour')
    `);
    this.insertCodeStmt = db.prepare(`
      INSERT INTO verification_codes (email, code, expires_at)
      VALUES (@email, @code, @expires_at)
    `);
    this.deleteCodeStmt = db.prepare('DELETE FROM verification_codes WHERE id = ?');
    this.findCodeStmt = db.prepare(`
      SELECT id FROM verification_codes
      WHERE email = ? AND code = ? AND consumed = 0 AND expires_at > ?
      ORDER BY id DESC
      LIMIT 1
    `);
    this.consumeStmt = db.prepare(`
      UPDATE verification_codes SET consumed = 1 WHERE id = ? AND consumed = 0
    `);
    this.findTokenStmt = db.prepare('SELECT id, email FROM device_verifications WHERE device_token = ?');
    this.refreshStmt = db.prepare('UPDATE device_verifications SET expires_at = ? WHERE id = ?');
    this.insertDeviceStmt = db.prepare(`
      INSERT INTO device_verifications (email, device_token, expires_at)
      VALUES (@email, @device_token, @expires_at)
    `);
    this.findValidStmt = db.prepare(`
      SELECT id, email, device_token, verified_at, expires_at
      FROM device_verifications
      WHERE email = ? AND device_token = ? AND expires_at > ?
    `);
  }

  reserveCode(email) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    return this.db.transaction(() => {
      if (this.countRecentStmt.get(email).n >= MAX_CODES_PER_HOUR) {
        return { limited: true };
      }
      const info = this.insertCodeStmt.run({ email, code, expires_at: expiresAt });
      return { limited: false, id: Number(info.lastInsertRowid), code };
    })();
  }

  deleteCode(id) {
    this.deleteCodeStmt.run(id);
  }

  confirm(email, code, existingToken, nowIso = new Date().toISOString()) {
    return this.db.transaction(() => {
      const row = this.findCodeStmt.get(email, code, nowIso);
      if (!row) return null;
      if (this.consumeStmt.run(row.id).changes !== 1) return null;
      return { deviceToken: this.tokenFor(email, existingToken) };
    })();
  }

  tokenFor(email, existingToken) {
    const expiresAt = new Date(Date.now() + DEVICE_MAX_AGE_MS).toISOString();
    if (isUuid(existingToken)) {
      const current = this.findTokenStmt.get(existingToken);
      if (current && current.email === email) {
        this.refreshStmt.run(expiresAt, current.id);
        return existingToken;
      }
    }
    const deviceToken = crypto.randomUUID();
    this.insertDeviceStmt.run({ email, device_token: deviceToken, expires_at: expiresAt });
    return deviceToken;
  }

  findValid(email, deviceToken, nowIso = new Date().toISOString()) {
    if (!email || !deviceToken) return null;
    return this.findValidStmt.get(email, deviceToken, nowIso) || null;
  }
}
