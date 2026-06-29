/**
 * Domain errors. Each carries an HTTP `statusCode` so the API/server-action
 * layer can map them onto a response without inspecting `instanceof` chains.
 */

export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

/** Caller is signed in but lacks permission for the requested action. */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

/**
 * The resource doesn't exist — OR it exists in another agency. We deliberately
 * collapse both cases into one error so we never leak the existence of
 * out-of-tenant rows.
 */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

/** Input failed validation (Zod, etc.). */
export class ValidationError extends AppError {
  readonly issues?: unknown;
  constructor(message = "Invalid input", issues?: unknown) {
    super(message, 422);
    this.issues = issues;
  }
}
