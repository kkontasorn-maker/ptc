import { PsapiError } from '../errors.js';
import { MOCK_GUARDIANS, MOCK_SCHOOLS, MOCK_TEACHERS } from './mock-data.js';

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function schoolFromRecord(record) {
  const row = record?.tables?.schools
    || record?.schools
    || record;
  if (!row || typeof row !== 'object') return null;
  const id = row.powerschool_school_id ?? row.school_number ?? row.schoolid
    ?? row.school_id ?? row.id ?? row.dcid;
  const name = text(row.name || row.school_name || row.schoolname);
  if (id == null || text(id) === '' || !name) return null;
  return {
    powerschool_school_id: String(id),
    name,
  };
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
  // schoolid is present on schoolstaff rows; teachers table may use school_id.
  const schoolRaw = row.schoolid ?? row.school_id ?? row.powerschool_school_id;
  const schoolId = schoolRaw == null || text(schoolRaw) === '' ? null : String(schoolRaw);
  return {
    powerschool_teacher_id: String(id),
    display_name: displayName,
    email,
    photo_url: photo,
    room,
    powerschool_school_id: schoolId,
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
  return {
    student_powerschool_id: String(id),
    name,
    nickname,
    grade,
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

export function mapGuardianStudents(payload) {
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
  return mapped;
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

export function mapSchoolPayload(payload) {
  const records = Array.isArray(payload)
    ? payload
    : payload?.record
      || payload?.records
      || payload?.schools
      || [];
  if (!Array.isArray(records)) return [];
  const schools = [];
  const seen = new Set();
  for (const record of records) {
    const school = schoolFromRecord(record);
    if (!school || seen.has(school.powerschool_school_id)) continue;
    seen.add(school.powerschool_school_id);
    schools.push(school);
  }
  return schools;
}

function publicPsapiMessage(error) {
  if (error instanceof PsapiError) return error.message;
  return 'PowerSchool could not be reached';
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

const QUERYABLE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+$/;
const SCHEMA_PAGE_SIZE = 100;
const ID_CHUNK = 40;

function numericIds(values) {
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const id = text(value);
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function chunks(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function inQuery(field, ids) {
  return `${field}=in=(${ids.join(',')})`;
}

function schemaRows(payload, tableName) {
  const records = Array.isArray(payload)
    ? payload
    : payload?.record || payload?.records || [];
  if (!Array.isArray(records)) return [];
  const rows = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const nested = record.tables?.[tableName] || record[tableName];
    rows.push(nested && typeof nested === 'object' ? nested : record);
  }
  return rows;
}

function activeContact(value) {
  return value === true || value === 1 || text(value) === '1';
}

function studentDcid(record) {
  const row = record?.tables?.students || record?.students || record;
  return text(row?.dcid);
}

export function createPsapiClient({
  baseUrl = '',
  clientId = '',
  clientSecret = '',
  teachersPath = '/ws/schema/table/teachers',
  // Exact schools endpoint should be re-verified with real PowerSchool credentials;
  // /ws/schema/table/schools is the provisional mirror of the teachers path.
  schoolsPath = '/ws/schema/table/schools',
  studentsPath = '/ws/schema/table/students',
  fetchImpl = fetch,
} = {}) {
  const configured = Boolean(baseUrl && clientId && clientSecret);
  const connection = {
    connected: false,
    lastSuccessfulCallAt: null,
    error: null,
  };

  function connectionStatus() {
    return {
      connected: connection.connected,
      lastSuccessfulCallAt: connection.lastSuccessfulCallAt,
      error: connection.error,
    };
  }

  function recordSuccess(now = new Date()) {
    connection.connected = true;
    connection.lastSuccessfulCallAt = now;
    connection.error = null;
  }

  function recordFailure(error) {
    connection.connected = false;
    connection.error = publicPsapiMessage(error);
  }

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

  async function listSchoolsFromPowerSchool() {
    // Exact PS endpoint / projection should be re-verified with real credentials.
    const token = await fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl });
    const schools = [];
    const seen = new Set();
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(schoolsPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      url.searchParams.set('pagesize', '100');
      url.searchParams.set('page', String(page));
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new PsapiError('PowerSchool school request failed');
      const batch = mapSchoolPayload(await response.json());
      if (batch.length === 0) break;
      if (seen.has(batch[0].powerschool_school_id)) break;
      for (const school of batch) {
        if (seen.has(school.powerschool_school_id)) continue;
        seen.add(school.powerschool_school_id);
        schools.push(school);
      }
      if (batch.length < 100) break;
    }
    return schools;
  }

  function schemaUrl(path, params) {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  async function readSchema(token, path, params, tableName, failureMessage) {
    const rows = [];
    const seenPage = new Set();
    for (let page = 1; page <= 50; page += 1) {
      const response = await fetchImpl(schemaUrl(path, {
        ...params,
        pagesize: String(SCHEMA_PAGE_SIZE),
        page: String(page),
      }), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new PsapiError(failureMessage);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new PsapiError(failureMessage);
      }
      const batch = schemaRows(payload, tableName);
      if (batch.length === 0) break;
      const marker = text(batch[0].id ?? batch[0].dcid ?? batch[0].emailaddressid ?? batch[0].personid ?? batch[0].studentcontactassocid);
      if (marker && seenPage.has(marker)) break;
      if (marker) seenPage.add(marker);
      rows.push(...batch);
      if (batch.length < SCHEMA_PAGE_SIZE) break;
    }
    return rows;
  }

  async function readSchemaByIds(token, path, field, ids, projection, tableName, failureMessage, extraQuery = '') {
    const rows = [];
    for (const group of chunks(ids, ID_CHUNK)) {
      const q = extraQuery ? `${inQuery(field, group)};${extraQuery}` : inQuery(field, group);
      const params = { q };
      if (projection) params.projection = projection;
      const batch = await readSchema(token, path, params, tableName, failureMessage);
      rows.push(...batch);
    }
    return rows;
  }

  // Guardian match is EmailAddress → PersonEmailAddressAssoc → StudentContactAssoc
  // → StudentContactDetail (isactive=1) → students by dcid. Any active contact counts.
  async function studentsFromPowerSchool(email) {
    if (!QUERYABLE_EMAIL.test(email)) throw new PsapiError('PowerSchool email address request failed');
    const token = await fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl });

    const emailRows = await readSchema(token, '/ws/schema/table/emailaddress', {
      projection: 'emailaddressid,emailaddress',
      q: `emailaddress==${email}`,
    }, 'emailaddress', 'PowerSchool email address request failed');
    const emailIds = numericIds(emailRows
      .filter((row) => text(row.emailaddress).toLowerCase() === email)
      .map((row) => row.emailaddressid));
    if (emailIds.length === 0) return [];

    const personRows = await readSchemaByIds(
      token,
      '/ws/schema/table/personemailaddressassoc',
      'emailaddressid',
      emailIds,
      'personid,emailaddressid',
      'personemailaddressassoc',
      'PowerSchool person email request failed',
    );
    const emailIdSet = new Set(emailIds);
    const personIds = numericIds(personRows
      .filter((row) => emailIdSet.has(text(row.emailaddressid)))
      .map((row) => row.personid));
    if (personIds.length === 0) return [];

    const contactRows = await readSchemaByIds(
      token,
      '/ws/schema/table/studentcontactassoc',
      'personid',
      personIds,
      'studentdcid,studentcontactassocid,personid',
      'studentcontactassoc',
      'PowerSchool student contact request failed',
    );
    const personIdSet = new Set(personIds);
    const associations = [];
    const seenAssoc = new Set();
    for (const row of contactRows) {
      const personOnRow = text(row.personid);
      if (personOnRow && !personIdSet.has(personOnRow)) continue;
      const assocId = text(row.studentcontactassocid);
      const dcid = text(row.studentdcid);
      if (!/^\d+$/.test(assocId) || !/^\d+$/.test(dcid) || seenAssoc.has(assocId)) continue;
      seenAssoc.add(assocId);
      associations.push({ studentcontactassocid: assocId, studentdcid: dcid });
    }
    if (associations.length === 0) return [];

    const detailRows = await readSchemaByIds(
      token,
      '/ws/schema/table/studentcontactdetail',
      'studentcontactassocid',
      associations.map((row) => row.studentcontactassocid),
      'studentcontactassocid,isactive',
      'studentcontactdetail',
      'PowerSchool contact detail request failed',
      'isactive==1',
    );
    const assocIdSet = new Set(associations.map((row) => row.studentcontactassocid));
    const activeAssocIds = new Set(detailRows
      .filter((row) => assocIdSet.has(text(row.studentcontactassocid)) && activeContact(row.isactive))
      .map((row) => text(row.studentcontactassocid)));
    const dcids = [];
    const seenDcid = new Set();
    for (const row of associations) {
      if (!activeAssocIds.has(row.studentcontactassocid) || seenDcid.has(row.studentdcid)) continue;
      seenDcid.add(row.studentdcid);
      dcids.push(row.studentdcid);
    }
    if (dcids.length === 0) return [];

    const studentRows = await readSchemaByIds(
      token,
      studentsPath,
      'dcid',
      dcids,
      '',
      'students',
      'PowerSchool student request failed',
    );
    const wanted = new Set(dcids);
    const byDcid = new Map();
    for (const record of studentRows) {
      const dcid = studentDcid(record);
      if (!wanted.has(dcid) || byDcid.has(dcid)) continue;
      byDcid.set(dcid, record.tables?.students ? record : { tables: { students: record } });
    }
    return mapGuardianStudents(dcids.map((dcid) => byDcid.get(dcid)).filter(Boolean));
  }

  async function probeStudents() {
    const token = await fetchAccessToken({ baseUrl, clientId, clientSecret, fetchImpl });
    const url = new URL(studentsPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.searchParams.set('pagesize', '1');
    url.searchParams.set('page', '1');
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new PsapiError('PowerSchool student request failed');
    await response.json().catch(() => null);
  }

  async function remember(run) {
    try {
      const result = await run();
      recordSuccess();
      return result;
    } catch (error) {
      recordFailure(error);
      if (error instanceof PsapiError) throw error;
      throw new PsapiError('PowerSchool could not be reached');
    }
  }

  return {
    configured,
    connectionStatus,
    async listTeachers() {
      if (!configured) {
        return {
          source: 'mock',
          teachers: MOCK_TEACHERS.map((teacher) => ({ ...teacher })),
        };
      }
      const teachers = await remember(listFromPowerSchool);
      return { source: 'powerschool', teachers };
    },
    async listSchools() {
      if (!configured) {
        return {
          source: 'mock',
          schools: MOCK_SCHOOLS.map((school) => ({ ...school })),
        };
      }
      const schools = await remember(listSchoolsFromPowerSchool);
      return { source: 'powerschool', schools };
    },
    async studentsForGuardian(email) {
      const key = text(email).toLowerCase();
      if (!configured) {
        return {
          source: 'mock',
          students: cloneStudents(MOCK_GUARDIANS[key] || []),
        };
      }
      const students = await remember(() => studentsFromPowerSchool(key));
      return { source: 'powerschool', students };
    },
    async testConnection() {
      if (!configured) {
        recordFailure(new PsapiError('PowerSchool is not configured'));
        return connectionStatus();
      }
      try {
        await probeStudents();
        recordSuccess();
      } catch (error) {
        recordFailure(error);
        console.error('PowerSchool test failed');
      }
      return connectionStatus();
    },
  };
}
