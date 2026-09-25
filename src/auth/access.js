import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors.js';

export function requireAuth(req, res, next) {
  if (!req.user) {
    next(new UnauthorizedError('Sign in required'));
    return;
  }
  next();
}

export function rejectFrontOfficeWrite(req, res, next) {
  if (req.user?.activeRole === 'front_office') {
    next(new ForbiddenError('You do not have access to this action'));
    return;
  }
  next();
}

export function requireItAdminOrFrontOffice(req, res, next) {
  if (!req.user) {
    next(new UnauthorizedError('Sign in required'));
    return;
  }
  if (req.user.activeRole === 'it_admin' || req.user.activeRole === 'front_office') {
    next();
    return;
  }
  next(new ForbiddenError('You do not have access to this action'));
}

export function requireItAdmin(req, res, next) {
  if (!req.user) {
    next(new UnauthorizedError('Sign in required'));
    return;
  }
  if (req.user.activeRole !== 'it_admin') {
    next(new ForbiddenError('You do not have access to this action'));
    return;
  }
  next();
}

export function assertEventVisible(event, role) {
  if (!event || (role === 'parent' && !event.is_open_for_booking)) {
    throw new NotFoundError('Event not found');
  }
  return event;
}

function teacherOwns(user, staff) {
  return Boolean(user.teacherid) && user.teacherid === staff.powerschool_teacher_id;
}

export function assertCanReadAvailability(user, staff) {
  if (!user) throw new UnauthorizedError('Sign in required');
  if (user.activeRole === 'it_admin' || user.activeRole === 'front_office') return;
  if (user.activeRole === 'teacher' && teacherOwns(user, staff)) return;
  if (user.activeRole === 'teacher') {
    throw new ForbiddenError('You can only view your own availability');
  }
  throw new ForbiddenError('You do not have access to this action');
}

export function assertCanWriteAvailability(user, staff) {
  if (!user) throw new UnauthorizedError('Sign in required');
  if (user.activeRole === 'it_admin') return;
  if (user.activeRole === 'teacher' && teacherOwns(user, staff)) return;
  if (user.activeRole === 'teacher') {
    throw new ForbiddenError('You can only change your own availability');
  }
  throw new ForbiddenError('You do not have access to this action');
}
