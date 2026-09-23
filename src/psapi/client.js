import { PsapiError } from '../errors.js';
import { MOCK_GUARDIANS, MOCK_TEACHERS } from './mock-data.js';

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

function studentFromRecord(record) {
  const row = record?.tables?.students || record?.students || record;
  if (!row || typeof row !== 'object') return null;
  const id = row.student_powerschool_id ?? row.id ?? row.student_number ?? row.dcid ?? row.local_id;
  const name = text(row.name || row.lastfirst || row.last_first
    || [row.first_name, row.last_name].filter(Boolean).join(' ')
    || [row.firstName, row.lastName].filter(Boolean).join(' '));
  if (id == null || !name) return null;
  const nickname = text(row.nickname || row.student_nickname || row.preferred_name) || null;
  const gradeValue = row.grade ?? row.grade_level ?? row.student_grade;
  const grade = gradeValue == null || text(gradeValue) === '' ? null : text(gradeValue);
  const guardianEmail = text(
    row.guardian_email || row.contact_email || record?.guardian_email || record?.contact_email,
  ).toLowerCase();
  return {
    student_powerschool_id: String(id),
    name,
    nickname,
    grade,
    guardian_email: guardianEmail,
    teachers: teachersFromStudent(row.teachers || row.sections || row.cc || record?.teachers || []),
  };
}

function teachersFromStudent(list) {
  if (!Array.isArray(list)) return [];
  const teachers = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const source = item.tables?.teachers || item.tables?.sections || item.teacher || item;
    const id = source.powerschool_teacher_id ?? source.teacherid ?? source.teacher_id ?? source.id ?? item.teacherid;
    if (id == null || text(id) === '') continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const room = text(source.room || source.homeroom || item.room || item.room_number) || null;
    teachers.push({ powerschool_teacher_id: key, room });
  }
  return teachers;
}

export function mapGuardianStudents(payload, email = '') {
  const records = Array.isArray(payload)
    ? payload
    : payload?.students
      || payload?.record
      || payload?.records
      || [];
  if (!Array.isArray(records)) return [];
  const mapped = [];
  const seen = new Set();
  for (const record of records) {
    const student = studentFromRecord(record);
    if (!student || seen.has(student.student_powerschool_id)) continue;
    seen.add(student.student_powerschool_id);
    mapped.push(student);
  }
  const requested = text(email).toLowerCase();
  const tagged = mapped.some((student) => student.guardian_email);
  const selected = requested && tagged
    ? mapped.filter((student) => student.guardian_email === requested)
    : mapped;
  return selected.map((student) => ({
    student_powerschool_id: student.student_powerschool_id,
    name: student.name,
    nickname: student.nickname,
    grade: student.grade,
    teachers: student.teachers,
  }));
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

function cloneStudents(students) {
  return students.map((student) => ({
    ...student,
    teachers: student.teachers.map((teacher) => ({ ...teacher })),
  }));
}

export function createPsapiClient({
  baseUrl = '',
  clientId = '',
  clientSecret = '',
  teachersPath = '/ws/schema/table/teachers',
  studentsPath = '/ws/schema/table/students',
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

  // TODO: the PTC spec does not name the PowerSchool guardian query.
  // PSAPI_STUDENTS_PATH is that resource. The address is sent as guardian_email.
  async function studentsFromPowerSchool(email) {
    const token = await fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl });
    const url = new URL(studentsPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.searchParams.set('guardian_email', email);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new PsapiError('PowerSchool student request failed');
    return mapGuardianStudents(await response.json(), email);
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
    async studentsForGuardian(email) {
      const key = text(email).toLowerCase();
      if (!configured) {
        return {
          source: 'mock',
          students: cloneStudents(MOCK_GUARDIANS[key] || []),
        };
      }
      const students = await studentsFromPowerSchool(key);
      return { source: 'powerschool', students };
    },
  };
}
