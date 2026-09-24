import { HttpError } from './errors.js';

export function asyncHandler(fn) {
  return function asyncWrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    if (Array.isArray(err.bookings)) body.error.bookings = err.bookings;
    res.status(err.status).json(body);
    return;
  }

  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'VALIDATION', message: 'Request body must be valid JSON' },
    });
    return;
  }

  if (err?.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'VALIDATION', message: 'Request body is too large' },
    });
    return;
  }

  if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_')) {
    console.error(err);
    if (err.code.startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'The change conflicts with existing data' },
      });
      return;
    }
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
}
