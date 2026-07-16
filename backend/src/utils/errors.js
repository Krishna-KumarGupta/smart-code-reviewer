export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class GitHubAPIError extends AppError {
  constructor(message, details = null) {
    super(message, 502, details);
  }
}

export class DatabasePersistenceError extends AppError {
  constructor(message, details = null) {
    super(message, 500, details);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, details);
  }
}
