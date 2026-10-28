import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import LogoGenerator from "@/components/public/logo-generator";
import { PERMS } from "@/lib/permission-slugs";
import LogoPage from "./page";

const state = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("@/actions/save-logo", () => ({ saveLogo: vi.fn() }));
vi.mock("@/lib/hotel-name", () => ({
	resolveHotelName: async () => "Fixture hotel",
}));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	getApiAdminContext: async () => state.context,
	canAccess: (permissions: { has: (slug: string) => boolean }, slug: string) =>
		permissions.has(slug),
}));

beforeEach(() => {
	state.context = null;
});

it.each([
	["anonymous", null, false],
	["settings viewer", [PERMS.ADMIN_DASHBOARD, PERMS.SETTINGS_VIEW], false],
	["editor without housekeeping access", [PERMS.SETTINGS_EDIT], false],
	["settings editor", [PERMS.ADMIN_DASHBOARD, PERMS.SETTINGS_EDIT], true],
] as const)(
	"offers site-logo saving only to authorized %s",
	async (_name, slugs, canSave) => {
		state.context = slugs
			? {
					session: { user: { rank: 7 } },
					permissions: {
						has: (slug: string) => (slugs as readonly string[]).includes(slug),
					},
				}
			: null;
		const html = renderToStaticMarkup(await LogoPage());
		expect(html.includes("Save as site logo")).toBe(canSave);
		expect(html).toContain("Download PNG");
		expect(html).toContain("Download all fonts");
	},
);

it("defaults the generator to download-only without server authorization", () => {
	const html = renderToStaticMarkup(<LogoGenerator />);
	expect(html).not.toContain("Save as site logo");
	expect(html).toContain("Download PNG");
});
