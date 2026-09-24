const PURPOSES = new Set([
  'verification_code',
  'booking_confirmation',
  'summary',
  'conflict_notification',
]);

const STATUSES = new Set(['sent', 'delivered', 'bounced', 'complained', 'unknown']);

function relatedIdValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return number;
}

export class NotificationRepository {
  constructor(db) {
    this.db = db;
    this.insertSentStmt = db.prepare(`
      INSERT INTO email_deliveries (
        recipient_email, purpose, related_id, provider_message_id, status
      ) VALUES (?, ?, ?, ?, 'sent')
    `);
    this.updateStatusStmt = db.prepare(`
      UPDATE email_deliveries
      SET status = ?, status_detail = ?, status_updated_at = datetime('now')
      WHERE provider_message_id = ?
    `);
    this.findPreferenceStmt = db.prepare(`
      SELECT email, fallback_contact_type, fallback_contact_value, updated_at
      FROM parent_contact_preferences
      WHERE email = ?
    `);
    this.upsertPreferenceStmt = db.prepare(`
      INSERT INTO parent_contact_preferences (
        email, fallback_contact_type, fallback_contact_value, updated_at
      ) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        fallback_contact_type = excluded.fallback_contact_type,
        fallback_contact_value = excluded.fallback_contact_value,
        updated_at = datetime('now')
    `);
  }

  recordSent({ recipientEmail, purpose, relatedId, providerMessageId }) {
    if (!PURPOSES.has(purpose)) return null;
    const email = String(recipientEmail || '').trim().toLowerCase();
    if (!email) return null;
    const messageId = typeof providerMessageId === 'string' && providerMessageId.trim()
      ? providerMessageId.trim()
      : null;
    const info = this.insertSentStmt.run(email, purpose, relatedIdValue(relatedId), messageId);
    return Number(info.lastInsertRowid);
  }

  applyStatus({ providerMessageId, status, statusDetail }) {
    if (!STATUSES.has(status)) return 0;
    const messageId = String(providerMessageId || '').trim();
    if (!messageId) return 0;
    const detail = statusDetail == null || statusDetail === ''
      ? null
      : String(statusDetail).slice(0, 500);
    return this.updateStatusStmt.run(status, detail, messageId).changes;
  }

  findPreference(email) {
    return this.findPreferenceStmt.get(email) || null;
  }

  upsertPreference({ email, fallback_contact_type: type, fallback_contact_value: value }) {
    this.upsertPreferenceStmt.run(email, type, value);
    return this.findPreference(email);
  }

  listDeliveryIssues(staleHours) {
    const hours = Number.isFinite(Number(staleHours)) && Number(staleHours) > 0
      ? Math.floor(Number(staleHours))
      : 24;
    const rows = this.db.prepare(`
      SELECT
        d.id,
        d.recipient_email,
        d.purpose,
        d.sent_at,
        d.status,
        d.status_detail,
        p.email AS pref_email,
        p.fallback_contact_type,
        p.fallback_contact_value,
        p.updated_at AS pref_updated_at
      FROM email_deliveries d
      LEFT JOIN parent_contact_preferences p ON p.email = d.recipient_email
      WHERE d.status IN ('bounced', 'complained')
         OR (
           d.status = 'sent'
           AND d.status_updated_at IS NULL
           AND d.sent_at <= datetime('now', ?)
         )
      ORDER BY d.sent_at DESC, d.id DESC
    `).all(`-${hours} hours`);
    return rows.map((row) => ({
      id: row.id,
      recipient_email: row.recipient_email,
      purpose: row.purpose,
      sent_at: row.sent_at,
      status: row.status,
      status_detail: row.status_detail,
      unconfirmed: row.status === 'sent',
      fallback_contact: row.pref_email ? {
        email: row.pref_email,
        fallback_contact_type: row.fallback_contact_type,
        fallback_contact_value: row.fallback_contact_value,
        updated_at: row.pref_updated_at,
      } : null,
    }));
  }
}
