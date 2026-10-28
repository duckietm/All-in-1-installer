import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	getAdminContext: async () => ({
		session: { user: { rank: 1 } },
		permissions: {},
	}),
	canAccess: mocks.access,
	PERMS: { DEVOPS_VIEW: "devops.view" },
}));
vi.mock("next/navigation", () => ({
	redirect: () => {
		throw new Error("redirect");
	},
}));
vi.mock("@/lib/error-monitor", () => ({
	ErrorStore: class {
		read = mocks.read;
	},
}));
vi.mock("@/components/link", () => ({ default: () => null }));

vi.mock("next-intl/server", () => ({
	getTranslations: async () => (key: string) => key,
}));
vi.mock("./actions", () => ({
	assignCmsError: vi.fn(),
	resolveCmsError: vi.fn(),
}));

import Page from "./page";

it("rejects access before reading diagnostic data", async () => {
	mocks.access.mockReturnValue(false);
	await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
		"redirect",
	);
	expect(mocks.read).not.toHaveBeenCalled();
});

it("shows the referenced occurrence while retaining the current group resolution", async () => {
	mocks.access.mockImplementation(
		(_permissions, permission) => permission === "devops.view",
	);
	const old = {
		id: "old-reference",
		fingerprint: "same-group",
		at: "2026-09-10T10:00:00Z",
		release: "old-release",
		source: "server",
		event: "Delivery failed",
		message: "Failure",
		stack: "OLDER_ERROR_STACK",
		context: { deliveryId: "older-delivery" },
		resolved: false,
	};
	const newer = {
		...old,
		id: "new-reference",
		at: "2026-09-11T10:00:00Z",
		release: "new-release",
		stack: "NEWER_ERROR_STACK",
		context: { deliveryId: "newer-delivery" },
		resolved: true,
	};
	mocks.read.mockResolvedValue({ records: [old, newer], truncated: false });
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ q: "old-reference" }) }),
	);
	expect(html).toContain("OLDER_ERROR_STACK");
	expect(html).toContain("older-delivery");
	expect(html).not.toContain("NEWER_ERROR_STACK");
	expect(html).not.toContain("newer-delivery");
	expect(html).toContain("resolved");
});
