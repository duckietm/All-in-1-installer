import { afterEach, expect, it, vi } from "vitest";
import { readImportResponse } from "@/lib/furni/import-response";
import { streamImportResponse } from "./single-response";

vi.mock("@/lib/server-log", () => ({ logServerError: vi.fn() }));
afterEach(() => vi.useRealTimers());
it("sends headers and heartbeats before a slow operation finishes", async () => {
	vi.useFakeTimers();
	let finish!: (response: Response) => void;
	const operation = vi.fn(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	const response = streamImportResponse(operation);
	expect(response.headers.get("X-Accel-Buffering")).toBe("no");
	if (!response.body) throw Error("Missing stream");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	expect(decoder.decode((await reader.read()).value)).toContain('"started"');
	await vi.advanceTimersByTimeAsync(10000);
	expect(decoder.decode((await reader.read()).value)).toContain('"processing"');
	finish(Response.json({ ok: true, id: 42 }));
	expect(decoder.decode((await reader.read()).value)).toContain('"id":42');
	expect((await reader.read()).done).toBe(true);
	expect(operation).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});
it("preserves failure status and the importer error", async () => {
	const result = await readImportResponse(
		streamImportResponse(async () =>
			Response.json({ error: "Missing source asset" }, { status: 409 }),
		),
	);
	expect(result).toEqual({
		status: 409,
		data: { error: "Missing source asset" },
	});
});
it("delivers caught server failures instead of abruptly closing", async () => {
	const result = await readImportResponse(
		streamImportResponse(async () => {
			throw Error("private database details");
		}),
	);
	expect(result.status).toBe(500);
	expect(result.data.error).toContain("Some changes may already be saved");
	expect(result.data.error).not.toContain("private database");
});
it("reports proxy timeout status without rendering proxy HTML", async () => {
	await expect(
		readImportResponse(
			new Response("<html>gateway error</html>", { status: 524 }),
		),
	).rejects.toThrow("HTTP 524");
});
it("does not treat a truncated stream as successful", async () => {
	await expect(
		readImportResponse(
			new Response('data: {"type":"progress"}\n\n', {
				headers: { "Content-Type": "text/event-stream" },
			}),
		),
	).rejects.toThrow("before confirmation");
});
it("preserves JSON authentication failures", async () => {
	expect(
		await readImportResponse(
			Response.json({ error: "Unauthorized" }, { status: 401 }),
		),
	).toEqual({ status: 401, data: { error: "Unauthorized" } });
});
