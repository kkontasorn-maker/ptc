import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors.js';

export function requireAuth(req, res, next) {
  if (!req.user) {
    next(new UnauthorizedError('Sign in required'));
    return;
  }
  next();
}

export function requireItAdmin(req, res, next) {
  if (!req.user) {
    next(new UnauthorizedError('Sign in required'));
    return;
  }
  if (req.user.role !== 'it_admin') {
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
  if (user.role === 'it_admin' || user.role === 'front_office') return;
  if (user.role === 'teacher' && teacherOwns(user, staff)) return;
  if (user.role === 'teacher') {
    throw new ForbiddenError('You can only view your own availability');
  }
  throw new ForbiddenError('You do not have access to this action');
}

export function assertCanWriteAvailability(user, staff) {
  if (!user) throw new UnauthorizedError('Sign in required');
  if (user.role === 'it_admin') return;
  if (user.role === 'teacher' && teacherOwns(user, staff)) return;
  if (user.role === 'teacher') {
    throw new ForbiddenError('You can only change your own availability');
  }
  throw new ForbiddenError('You do not have access to this action');
}
