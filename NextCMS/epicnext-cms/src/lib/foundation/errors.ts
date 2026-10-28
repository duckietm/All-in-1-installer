export class DomainError extends Error {
	public readonly status: number;

	constructor(message: string, status: number = 500) {
		super(message);
		this.name = "DomainError";
		this.status = status;
	}
}

export class NotFoundError extends DomainError {
	constructor(entity: string, id?: number | string) {
		super(id ? `${entity} #${id} not found` : `${entity} not found`, 404);
		this.name = "NotFoundError";
	}
}

export class UnauthorizedError extends DomainError {
	constructor(message: string = "Unauthorized") {
		super(message, 401);
		this.name = "UnauthorizedError";
	}
}

export class ForbiddenError extends DomainError {
	constructor(message: string = "Forbidden") {
		super(message, 403);
		this.name = "ForbiddenError";
	}
}

export class ValidationError extends DomainError {
	public readonly fieldErrors: Record<string, string[]>;

	constructor(fieldErrors: Record<string, string[]>) {
		super("Validation failed", 422);
		this.name = "ValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class RateLimitError extends DomainError {
	public readonly retryAfter: number;

	constructor(retryAfter: number) {
		super(`Rate limited. Try again in ${retryAfter}s.`, 429);
		this.name = "RateLimitError";
		this.retryAfter = retryAfter;
	}
}

export class DatabaseError extends DomainError {
	public readonly cause: unknown;

	constructor(message: string, cause?: unknown) {
		super(message, 500);
		this.name = "DatabaseError";
		this.cause = cause;
	}
}
