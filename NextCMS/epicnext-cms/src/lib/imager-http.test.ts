import { describe, expect, it } from "vitest";
import { ifNoneMatchSatisfied, strongEtag } from "./imager-http";

describe("strongEtag", () => {
	it("is deterministic and quote-wrapped", () => {
		const body = new Uint8Array([1, 2, 3]);
		expect(strongEtag(body)).toBe(strongEtag(new Uint8Array([1, 2, 3])));
		expect(strongEtag(body)).toMatch(/^"[A-Za-z0-9_-]+"$/);
	});

	it("changes when the body changes", () => {
		expect(strongEtag(new Uint8Array([1, 2, 3]))).not.toBe(
			strongEtag(new Uint8Array([1, 2, 4])),
		);
	});
});

describe("ifNoneMatchSatisfied", () => {
	const etag = strongEtag(new Uint8Array([9]));

	it("returns false without a header", () => {
		expect(ifNoneMatchSatisfied(null, etag)).toBe(false);
		expect(ifNoneMatchSatisfied("", etag)).toBe(false);
	});

	it("matches an exact, weak or wildcard validator", () => {
		expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
		expect(ifNoneMatchSatisfied(`W/${etag}`, etag)).toBe(true);
		expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
	});

	it("matches any entry in a comma-separated list", () => {
		expect(ifNoneMatchSatisfied(`"other", ${etag}`, etag)).toBe(true);
	});

	it("does not match a different validator", () => {
		expect(ifNoneMatchSatisfied('"other"', etag)).toBe(false);
	});
});
