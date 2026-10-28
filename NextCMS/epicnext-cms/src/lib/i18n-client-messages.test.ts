// @ts-nocheck
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The public route group installs a reduced catalogue (see
 * `publicClientMessages`). Anything a public page asks for must therefore live
 * outside the staff-only namespaces — a reference to one of them would silently
 * fall back to the raw key, so this is enforced here rather than discovered in
 * production.
 */

const SITE_DIR = join(process.cwd(), "src/app/(site)");
const STAFF_NAMESPACES = ['useTranslations("admin', 'getTranslations("admin'];

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
		} else if (/\.(ts|tsx)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("public client message scope", () => {
	it("the site route group has pages to check", () => {
		expect(sourceFiles(SITE_DIR).length).toBeGreaterThan(10);
	});

	it("no public page reads a staff-only namespace", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SITE_DIR)) {
			const src = readFileSync(file, "utf8");
			for (const ns of STAFF_NAMESPACES) {
				// `pages.admin.*` is the second form; `admin.*` the first.
				for (const needle of [
					`${ns})`,
					`${ns}.`,
					ns.replace("(admin", "(pages.admin"),
				]) {
					if (src.includes(needle)) {
						offenders.push(`${file.replace(process.cwd(), "")}: ${needle}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("publicClientMessages", () => {
	async function load() {
		const mod = await import("@/lib/i18n-client-messages");
		return mod.publicClientMessages;
	}

	it("strips the staff-only namespaces", async () => {
		const publicClientMessages = await load();
		const result = publicClientMessages({
			admin: { title: "x" },
			nav: { home: "Home" },
			pages: {
				admin: { dashboard: "y" },
				home: { title: "z" },
			},
		});
		expect(result.admin).toBeUndefined();
		expect(result.nav).toEqual({ home: "Home" });
		expect(result.pages.admin).toBeUndefined();
		expect(result.pages.home).toEqual({ title: "z" });
	});

	it("keeps every non-admin top-level namespace", async () => {
		const publicClientMessages = await load();
		const en = JSON.parse(
			readFileSync(join(process.cwd(), "src/messages/en.json"), "utf8"),
		);
		const result = publicClientMessages(en);
		for (const key of Object.keys(en)) {
			if (key === "admin") continue;
			expect(result[key]).toBeDefined();
		}
		// `pages.admin` survives only in the shape the shared server-action hook
		// needs: the generic `actions` copy, nothing staff-specific.
		expect(Object.keys(result.pages.admin)).toEqual(["actions"]);
		expect(result.pages.admin.actions.saved).toBe(en.pages.admin.actions.saved);
		expect(result.pages.admin.nav).toBeUndefined();
		expect(result.pages.admin.catalog).toBeUndefined();
	});

	it("actually shrinks the catalogue", async () => {
		const publicClientMessages = await load();
		const en = JSON.parse(
			readFileSync(join(process.cwd(), "src/messages/en.json"), "utf8"),
		);
		const full = JSON.stringify(en).length;
		const scoped = JSON.stringify(publicClientMessages(en)).length;
		// The staff-tool namespaces dominate the file; without them the payload
		// should drop by well over half.
		expect(scoped).toBeLessThan(full * 0.5);
	});

	it("does not mutate the input", async () => {
		const publicClientMessages = await load();
		const en = JSON.parse(
			readFileSync(join(process.cwd(), "src/messages/en.json"), "utf8"),
		);
		const before = JSON.stringify(en).length;
		publicClientMessages(en);
		expect(JSON.stringify(en).length).toBe(before);
		expect(en.pages.admin).toBeDefined();
	});
});

/**
 * Scoping only works if the reduced catalogue goes to the client *and* every
 * staff route group re-installs the full one. These two halves drift silently:
 * narrowing the root without adding a staff provider renders raw keys in the
 * admin panel, and the reverse just costs bytes. Both are asserted here.
 */
describe("client catalogue scoping is wired up", () => {
	const STAFF_LAYOUTS = [
		"src/app/admin/layout.tsx",
		"src/app/admin-next/layout.tsx",
		"src/app/mod/layout.tsx",
	];

	it("the root layout feeds the reduced catalogue to its provider", () => {
		const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
		expect(src).toContain("publicClientMessages(await getMessages())");
	});

	for (const layout of STAFF_LAYOUTS) {
		it(`${layout} re-installs the full catalogue`, () => {
			const src = readFileSync(join(process.cwd(), layout), "utf8");
			expect(src).toContain("NextIntlClientProvider");
			expect(src).toContain("getMessages()");
		});
	}
});

/**
 * A client component that reads `admin.*` / `pages.admin.*` outside a staff
 * route group would fall back to raw keys once the root catalogue is scoped,
 * because the provider it inherits no longer carries them. Staff trees are the
 * ones that install the full catalogue; the allowlist holds shared code that
 * deliberately runs on public pages too.
 */
describe("staff namespace consumers sit in a staff tree", () => {
	const STAFF_TREE =
		/^src[\\/](app[\\/](admin|admin-next|mod)[\\/]|components[\\/]admin[\\/]|features[\\/](catalog|operations|history|housekeeping)[\\/])/;
	const ALLOWLIST = new Set(["src/hooks/use-server-action.ts"]);
	const CLIENT_STAFF_NS = /useTranslations\((["`])((admin)|(pages\.admin))/;

	it("there is source to scan", () => {
		expect(sourceFiles(join(process.cwd(), "src")).length).toBeGreaterThan(500);
	});

	it("no stray consumer of a staff namespace", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(join(process.cwd(), "src"))) {
			const rel = file.slice(process.cwd().length + 1).replaceAll("\\", "/");
			if (rel.includes(".test.")) continue;
			if (STAFF_TREE.test(rel) || ALLOWLIST.has(rel)) continue;
			if (CLIENT_STAFF_NS.test(readFileSync(file, "utf8"))) offenders.push(rel);
		}
		expect(offenders).toEqual([]);
	});
});
