import express from 'express';
import { requireAuth, requireItAdmin } from '../auth/access.js';
import { asyncHandler } from '../http.js';
import { mergeSchools } from '../school-merge.js';

function presentSchool(school) {
  return {
    id: school.id,
    powerschool_school_id: school.powerschool_school_id,
    name: school.name,
    synced: Boolean(school.synced),
    in_powerschool: Boolean(school.in_powerschool),
  };
}

function presentLocalSchool(school) {
  return presentSchool({
    ...school,
    synced: true,
    in_powerschool: false,
  });
}

function prepareSchools(schools) {
  const usable = [];
  for (const school of schools) {
    const powerschoolSchoolId = String(school.powerschool_school_id || '').trim();
    const name = String(school.name || '').trim();
    if (!powerschoolSchoolId || !name) continue;
    usable.push({
      powerschool_school_id: powerschoolSchoolId,
      name,
    });
  }
  return usable;
}

async function loadPowerschool(psapi) {
  try {
    return { listed: await psapi.listSchools(), warning: null };
  } catch (error) {
    if (!psapi.configured) throw error;
    return {
      listed: null,
      warning: error instanceof Error ? error.message : 'PowerSchool could not be reached',
    };
  }
}

export function createSchoolRoutes({ repos, psapi }) {
  const router = express.Router();

  router.get('/schools', requireAuth, asyncHandler(async (req, res) => {
    if (!['it_admin', 'front_office', 'teacher'].includes(req.user.activeRole)) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have access to this action' },
      });
      return;
    }
    const { listed, warning } = await loadPowerschool(psapi);
    if (!listed) {
      const schools = repos.schools.list().map(presentLocalSchool);
      res.json({
        source: 'local',
        warning: warning || 'PowerSchool could not be reached. Showing saved schools only.',
        schools,
      });
      return;
    }
    const schools = mergeSchools(listed.schools, repos.schools.list()).map(presentSchool);
    res.json({ source: listed.source, schools });
  }));

  router.post('/schools/sync', requireItAdmin, asyncHandler(async (req, res) => {
    const listed = await psapi.listSchools();
    const usable = prepareSchools(listed.schools);
    const counts = repos.schools.sync(usable);
    const schools = mergeSchools(listed.schools, repos.schools.list()).map(presentSchool);
    res.json({
      source: listed.source,
      created: counts.created,
      updated: counts.updated,
      unchanged: counts.unchanged,
      schools,
    });
  }));

  return router;
}
