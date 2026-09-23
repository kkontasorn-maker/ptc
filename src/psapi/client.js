import { PsapiError } from '../errors.js';
import { MOCK_TEACHERS } from './mock-data.js';

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function teacherFromRecord(record) {
  const row = record?.tables?.teachers
    || record?.tables?.schoolstaff
    || record?.teachers
    || record;
  if (!row || typeof row !== 'object') return null;
  const id = row.id ?? row.dcid ?? row.teacherid ?? row.powerschool_teacher_id;
  const displayName = text(row.lastfirst || row.last_first || row.display_name || row.name
    || [row.first_name, row.last_name].filter(Boolean).join(' ')
    || [row.firstName, row.lastName].filter(Boolean).join(' '));
  if (id == null || !displayName) return null;
  const email = text(row.email_addr || row.email || row.emailaddress).toLowerCase();
  const room = text(row.room || row.homeroom) || null;
  const photo = text(row.photo_url) || null;
  return {
    powerschool_teacher_id: String(id),
    display_name: displayName,
    email,
    photo_url: photo,
    room,
  };
}

export function mapTeacherPayload(payload) {
  const records = Array.isArray(payload)
    ? payload
    : payload?.record
      || payload?.records
      || payload?.teachers
      || payload?.staff
      || [];
  if (!Array.isArray(records)) return [];
  const teachers = [];
  const seen = new Set();
  for (const record of records) {
    const teacher = teacherFromRecord(record);
    if (!teacher || seen.has(teacher.powerschool_teacher_id)) continue;
    seen.add(teacher.powerschool_teacher_id);
    teachers.push(teacher);
  }
  return teachers;
}

async function fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl }) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/oauth/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new PsapiError('PowerSchool authentication failed');
  const json = await response.json();
  if (!json.access_token) throw new PsapiError('PowerSchool authentication failed');
  return json.access_token;
}

export function createPsapiClient({
  baseUrl = '',
  clientId = '',
  clientSecret = '',
  teachersPath = '/ws/schema/table/teachers',
  fetchImpl = fetch,
} = {}) {
  const configured = Boolean(baseUrl && clientId && clientSecret);

  async function listFromPowerSchool() {
    const token = await fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl });
    const teachers = [];
    const seen = new Set();
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(teachersPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      url.searchParams.set('pagesize', '100');
      url.searchParams.set('page', String(page));
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new PsapiError('PowerSchool teacher request failed');
      const batch = mapTeacherPayload(await response.json());
      if (batch.length === 0) break;
      if (seen.has(batch[0].powerschool_teacher_id)) break;
      for (const teacher of batch) {
        if (seen.has(teacher.powerschool_teacher_id)) continue;
        seen.add(teacher.powerschool_teacher_id);
        teachers.push(teacher);
      }
      if (batch.length < 100) break;
    }
    return teachers;
  }

  return {
    configured,
    async listTeachers() {
      if (!configured) {
        return {
          source: 'mock',
          teachers: MOCK_TEACHERS.map((teacher) => ({ ...teacher })),
        };
      }
      const teachers = await listFromPowerSchool();
      return { source: 'powerschool', teachers };
    },
  };
}
