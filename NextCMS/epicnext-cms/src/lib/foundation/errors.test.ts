import { describe, expect, it } from "vitest";
import {
	DatabaseError,
	DomainError,
	ForbiddenError,
	NotFoundError,
	RateLimitError,
	UnauthorizedError,
	ValidationError,
} from "./errors";

describe("DomainError", () => {
	it("carries a message and status", () => {
		const err = new DomainError("bad", 418);
		expect(err.message).toBe("bad");
		expect(err.status).toBe(418);
		expect(err.name).toBe("DomainError");
	});
	it("defaults to HTTP 500", () => {
		expect(new DomainError("x").status).toBe(500);
	});
});

describe("NotFoundError", () => {
	it("formats message with and without an id", () => {
		expect(new NotFoundError("sofa").message).toBe("sofa not found");
		expect(new NotFoundError("sofa", 3).message).toBe("sofa #3 not found");
	});
	it("uses status 404", () => {
		expect(new NotFoundError("x").status).toBe(404);
	});
});

describe("UnauthorizedError", () => {
	it("defaults message and status", () => {
		const err = new UnauthorizedError();
		expect(err.message).toBe("Unauthorized");
		expect(err.status).toBe(401);
	});
	it("accepts a custom message", () => {
		expect(new UnauthorizedError("no token").message).toBe("no token");
	});
});

describe("ForbiddenError", () => {
	it("uses status 403", () => {
		const err = new ForbiddenError();
		expect(err.status).toBe(403);
		expect(err.message).toBe("Forbidden");
	});
});

describe("ValidationError", () => {
	it("carries field errors and status 422", () => {
		const err = new ValidationError({ name: ["too short"] });
		expect(err.status).toBe(422);
		expect(err.fieldErrors.name).toEqual(["too short"]);
	});
});

describe("RateLimitError", () => {
	it("exposes retryAfter and status 429", () => {
		const err = new RateLimitError(12);
		expect(err.status).toBe(429);
		expect(err.retryAfter).toBe(12);
		expect(err.message).toContain("12");
	});
});

describe("DatabaseError", () => {
	it("carries a cause and status 500", () => {
		const cause = new Error("conn refused");
		const err = new DatabaseError("query failed", cause);
		expect(err.status).toBe(500);
		expect(err.cause).toBe(cause);
	});
});
