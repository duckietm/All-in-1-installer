import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@/lib/media-storage", () => ({
	MEDIA_ROOT: path.resolve("storage/test-media"),
	resolveMediaPath: (name: string) => path.resolve("storage/test-media", name),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(existsSync).mockReturnValue(true);
	vi.mocked(readFile).mockResolvedValue(Buffer.from("fixture"));
});

async function get(segments: string[]) {
	return GET(new Request("http://localhost/api/media/test"), {
		params: Promise.resolve({ path: segments }),
	});
}
function secureHeaders(response: Response) {
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(response.headers.get("content-security-policy")).toBe(
		"default-src 'none'; sandbox",
	);
}

it.each([
	["photo.png", "image/png"],
	["favicon.ico", "image/x-icon"],
])("serves %s as an image with protective headers", async (name, mime) => {
	const response = await get([name]);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe(mime);
	expect(response.headers.get("content-disposition")).toBeNull();
	secureHeaders(response);
});

it("forces existing SVG files to download", async () => {
	const response = await get(["favicon", "old.SVG"]);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-disposition")).toBe("attachment");
	secureHeaders(response);
});

it.each([["..", "secret.png"], ["file.html"], ["bad\\file.png"]])(
	"secures forbidden path %j",
	async (...segments) => {
		const response = await get(segments);
		expect(response.status).toBe(403);
		expect(readFile).not.toHaveBeenCalled();
		secureHeaders(response);
	},
);

it("secures missing-file responses", async () => {
	vi.mocked(existsSync).mockReturnValue(false);
	const response = await get(["missing.png"]);
	expect(response.status).toBe(404);
	secureHeaders(response);
});

it.each([
	["ENOENT", 404],
	["EACCES", 500],
])(
	"handles %s while reading without leaking local paths",
	async (code, status) => {
		vi.mocked(readFile).mockRejectedValue(
			Object.assign(new Error("private/server/path"), { code }),
		);
		const response = await get(["image.png"]);
		expect(response.status).toBe(status);
		expect(await response.text()).not.toContain("private");
		secureHeaders(response);
	},
);
