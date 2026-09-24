export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(message, details) {
    super(400, 'VALIDATION', message, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Sign in required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have access to this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message, bookings) {
    super(409, 'CONFLICT', message);
    if (bookings) this.bookings = bookings;
  }
}

export class UnprocessableError extends HttpError {
  constructor(message) {
    super(422, 'UNPROCESSABLE', message);
  }
}

export class LockedError extends HttpError {
  constructor(message) {
    super(423, 'LOCKED', message);
  }
}

export class PsapiError extends HttpError {
  constructor(message) {
    super(502, 'PSAPI', message);
  }
}

export class RateLimitError extends HttpError {
  constructor(message = 'Too many codes were sent for this email. Try again later.') {
    super(429, 'RATE_LIMIT', message);
  }
}

export class NoStudentMatchError extends HttpError {
  constructor() {
    super(
      404,
      'NO_STUDENT_MATCH',
      "We couldn't match this email to a student. Please contact the front office.",
    );
  }
}

export class MailError extends HttpError {
  constructor() {
    super(502, 'MAIL', 'The verification email could not be sent');
  }
}
