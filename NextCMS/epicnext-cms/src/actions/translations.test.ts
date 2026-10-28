// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: [] as string[],
	saveCmsTranslation: vi.fn(),
	translationError: vi.fn<(code: string, args?: { key?: string }) => string>(),
	patchJson5: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
}));

const actionErrorClass = vi.hoisted(
	() =>
		class ActionError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "ActionError";
			}
		},
);

vi.mock("@/lib/safe-action", () => ({
	adminAction: (
		opts: { permission?: string | readonly string[]; schema?: any },
		handler: (ctx: any) => unknown,
	) => {
		return async (input: unknown) => {
			const needed = Array.isArray(opts.permission)
				? opts.permission
				: [opts.permission ?? ""];
			if (!needed.some((slug) => state.allowed.includes(slug))) {
				return { ok: false, error: "Unauthorized" };
			}
			const ctx: any = {
				session: { user: { id: 100, name: "staff", rank: 10 } },
			};
			if (opts.schema) {
				const parsed = opts.schema.safeParse(input);
				if (!parsed.success) {
					return {
						ok: false,
						error: "Validation failed",
						fieldErrors: parsed.error.flatten().fieldErrors,
					};
				}
				ctx.data = parsed.data;
			} else {
				ctx.data = input;
			}
			try {
				return await handler(ctx);
			} catch (error) {
				if (error instanceof actionErrorClass) {
					return { ok: false, error: error.message };
				}
				throw error;
			}
		};
	},
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: actionErrorClass,
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "admin.settings.edit" },
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("next-intl/server", () => ({
	getTranslations: async () => state.translationError,
}));

vi.mock("node:fs/promises", () => ({
	readFile: state.readFile,
	writeFile: state.writeFile,
	mkdir: vi.fn(),
	default: {
		readFile: state.readFile,
		writeFile: state.writeFile,
		mkdir: vi.fn(),
	},
}));

vi.mock("@/lib/cms-translations", () => ({
	CmsTranslationError: actionErrorClass,
	saveCmsTranslation: state.saveCmsTranslation,
}));

vi.mock("@/lib/json5-patch", () => ({
	patchJson5: state.patchJson5,
}));

const mockGetClientTranslationFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-translation-files", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/client-translation-files")>();
	return {
		...original,
		getClientTranslationFile: mockGetClientTranslationFile,
	};
});

import { CLIENT_TRANSLATION_FILES } from "@/lib/client-translation-files";
import { saveClientTranslations, saveTranslations } from "./translations";

const snapshot = { messages: { "a.b": "x" }, revision: "ab".repeat(32) };

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = ["admin.settings.edit"];
	state.translationError.mockImplementation(
		(code: string, args?: { key?: string }) => `[${code}:${args?.key ?? ""}]`,
	);
	mockGetClientTranslationFile.mockImplementation((id: string) =>
		CLIENT_TRANSLATION_FILES.find((f) => f.id === id),
	);
});

describe("saveTranslations", () => {
	it("persists a valid changeset and revalidates the layout", async () => {
		state.saveCmsTranslation.mockResolvedValue(snapshot);
		const res = await saveTranslations({
			locale: "en",
			revision: "a".repeat(64),
			changes: { "nav.home": "Home" },
		});
		expect(res).toEqual({ ok: true, data: { snapshot } });
		expect(state.saveCmsTranslation).toHaveBeenCalledWith(
			"en",
			"a".repeat(64),
			{ "nav.home": "Home" },
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
	});

	it("returns a translated conflict message on CmsTranslationError", async () => {
		const err = new actionErrorClass("conflict: ");
		(err as { code: string; key: string }).code = "conflict";
		(err as { code: string; key: string }).key = "";
		state.saveCmsTranslation.mockRejectedValue(err);
		const res = await saveTranslations({
			locale: "en",
			revision: "b".repeat(64),
			changes: {},
		});
		expect(res).toEqual({ ok: false, error: "[conflict:]" });
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("passes the errored key into the translation call", async () => {
		const err = new actionErrorClass("unknownKey: k");
		(err as { code: string; key: string }).code = "unknownKey";
		(err as { code: string; key: string }).key = "missing.key";
		state.saveCmsTranslation.mockRejectedValue(err);
		const res = await saveTranslations({
			locale: "en",
			revision: "c".repeat(64),
			changes: {},
		});
		expect(res).toEqual({ ok: false, error: "[unknownKey:missing.key]" });
	});

	it("re-throws errors that are not CmsTranslationError", async () => {
		state.saveCmsTranslation.mockRejectedValue(new Error("disk full"));
		await expect(
			saveTranslations({
				locale: "en",
				revision: "d".repeat(64),
				changes: {},
			}),
		).rejects.toThrow("disk full");
	});

	it("rejects an unsupported locale and a malformed revision", async () => {
		expect(
			await saveTranslations({
				locale: "xx" as never,
				revision: "a".repeat(64),
				changes: {},
			}),
		).toMatchObject({ ok: false, error: "Validation failed" });
		expect(
			await saveTranslations({ locale: "en", revision: "short", changes: {} }),
		).toMatchObject({ ok: false, error: "Validation failed" });
	});

	it("requires the settings edit permission", async () => {
		state.allowed = [];
		expect(
			await saveTranslations({
				locale: "en",
				revision: "a".repeat(64),
				changes: {},
			}),
		).toEqual({ ok: false, error: "Unauthorized" });
	});
});

describe("saveClientTranslations", () => {
	it("reports an unknown file id", async () => {
		mockGetClientTranslationFile.mockReturnValueOnce(undefined);
		const res = await saveClientTranslations({
			fileId: "badge-texts-en",
			data: {},
		});
		expect(res).toEqual({ ok: false, error: "Unknown file" });
	});

	it("refuses to write read-only files", async () => {
		const res = await saveClientTranslations({
			fileId: "ui-texts-en",
			data: {},
		});
		expect(res).toEqual({ ok: false, error: "File is read-only" });
		expect(state.writeFile).not.toHaveBeenCalled();
	});

	it("round-trips a plain JSON file", async () => {
		state.readFile.mockResolvedValue('"{}"');
		const res = await saveClientTranslations({
			fileId: "badge-texts-en",
			data: { x: "y" },
		});
		expect(res).toEqual({
			ok: true,
			data: { commentsLost: false, unpatchedKeys: [] },
		});
		expect(state.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("badge-texts-en.json"),
			JSON.stringify({ x: "y" }, null, 4),
			"utf-8",
		);
	});

	it("writes a surgical JSON5 patch when every key is patchable", async () => {
		state.readFile.mockResolvedValue('{"greeting": "hi",}');
		state.patchJson5.mockReturnValue({
			content: '{"greeting": "ciao",}',
			unpatchedKeys: [],
		});
		const res = await saveClientTranslations({
			fileId: "ui-texts-it",
			data: { greeting: "ciao" },
		});
		expect(res).toEqual({
			ok: true,
			data: { commentsLost: false, unpatchedKeys: [] },
		});
		expect(state.patchJson5).toHaveBeenCalledWith(
			'{"greeting": "hi",}',
			{ greeting: "hi" },
			{ greeting: "ciao" },
		);
		expect(state.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("UITexts.json5"),
			'{"greeting": "ciao",}',
			"utf-8",
		);
	});

	it("falls back to re-serialization and flags comment loss for unpatched keys", async () => {
		state.readFile.mockResolvedValue('{"known": "old",}');
		state.patchJson5.mockReturnValue({
			content: '{"known": "old",}',
			unpatchedKeys: ["brand-new"],
		});
		const res = await saveClientTranslations({
			fileId: "ui-texts-it",
			data: { known: "new", "brand-new": "val" },
		});
		expect(res).toEqual({
			ok: true,
			data: { commentsLost: true, unpatchedKeys: ["brand-new"] },
		});
		expect(state.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("UITexts.json5"),
			JSON.stringify({ known: "new", "brand-new": "val" }, null, 4),
			"utf-8",
		);
	});

	it("ignores non-object on-disk payloads before patching", async () => {
		state.readFile.mockResolvedValue("[1,2,3]");
		state.patchJson5.mockReturnValue({ content: "[]", unpatchedKeys: ["x"] });
		const res = await saveClientTranslations({
			fileId: "external-texts",
			data: { x: "1" },
		});
		expect(res).toEqual({
			ok: true,
			data: { commentsLost: true, unpatchedKeys: ["x"] },
		});
		expect(state.patchJson5).toHaveBeenCalledWith("[1,2,3]", {}, { x: "1" });
	});

	it("validates fileId against the whitelist", async () => {
		const res = await saveClientTranslations({
			fileId: "hack" as never,
			data: {},
		});
		expect(res).toMatchObject({ ok: false, error: "Validation failed" });
	});

	it("requires the settings edit permission", async () => {
		state.allowed = [];
		const res = await saveClientTranslations({
			fileId: "ui-texts-it",
			data: {},
		});
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("lets file-system errors propagate", async () => {
		state.readFile.mockRejectedValue(new Error("EACCES"));
		await expect(
			saveClientTranslations({ fileId: "ui-texts-it", data: {} }),
		).rejects.toThrow("EACCES");
	});
});
