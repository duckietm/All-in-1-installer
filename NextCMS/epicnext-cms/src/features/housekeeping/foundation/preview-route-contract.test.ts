import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import type { HousekeepingCapabilityContext } from "./contracts";

const routeMocks = vi.hoisted(() => {
	const messages: Record<string, string> = {
		"preview.badge": "HK::preview-badge",
		"preview.commandDisabled": "HK::command-disabled",
		"preview.backToSite": "HK::back-to-site",
		"navigation.skipToContent": "HK::skip-to-content",
		"navigation.primary": "HK::primary-navigation",
		"navigation.contextual": "HK::contextual-navigation",
		"domains.people.title": "HK::people-title",
		"domains.people.description": "Localized People description",
		"domains.economy.title": "Localized Economy",
		"domains.economy.description": "Localized Economy description",
		"states.empty.title": "Localized empty title",
		"states.empty.description": "Localized empty description",
	};
	const translate = vi.fn((key: string) => {
		const message = messages[key];
		if (message === undefined)
			throw new Error(`Unexpected translation: ${key}`);
		return message;
	});

	return {
		env: {
			NODE_ENV: "test" as "development" | "test" | "production",
			HOUSEKEEPING_NEXT_PREVIEW_ENABLED: true,
		},
		getHousekeepingCapabilityContext: vi.fn(),
		getTranslations: vi.fn(async (namespace: string) => {
			if (namespace !== "pages.housekeeping") {
				throw new Error(`Unexpected namespace: ${namespace}`);
			}
			return translate;
		}),
		getLocale: vi.fn(async () => "en"),
		getMessages: vi.fn(async () => ({})),
		notFound: vi.fn((): never => {
			throw new Error("NEXT_NOT_FOUND");
		}),
		redirect: vi.fn((href: string): never => {
			throw new Error(`NEXT_REDIRECT:${href}`);
		}),
		translate,
	};
});

vi.mock("@/env", () => ({ env: routeMocks.env }));
vi.mock("next/navigation", () => ({
	notFound: routeMocks.notFound,
	redirect: routeMocks.redirect,
}));
vi.mock("next-intl/server", () => ({
	getTranslations: routeMocks.getTranslations,
	getLocale: routeMocks.getLocale,
	getMessages: routeMocks.getMessages,
}));
vi.mock("@/features/housekeeping/foundation/server-capability-context", () => ({
	getHousekeepingCapabilityContext: routeMocks.getHousekeepingCapabilityContext,
}));
vi.mock("@/lib/db", () => {
	throw new Error("preview routes must not import the database");
});
vi.mock("@/lib/auth", () => {
	throw new Error("preview routes must not call auth directly");
});
vi.mock("@/lib/permissions", () => {
	throw new Error("preview routes must not reload permissions directly");
});
vi.mock("@/actions", () => {
	throw new Error("preview routes must not import actions");
});
vi.mock("@/app/actions", () => {
	throw new Error("preview routes must not import actions");
});

import AdminNextDomainLayout from "@/app/admin-next/[domain]/layout";
import AdminNextDomainPage from "@/app/admin-next/[domain]/page";
import AdminNextLayout from "@/app/admin-next/layout";
import AdminNextPage from "@/app/admin-next/page";

const routeFiles = [
	"src/app/admin-next/layout.tsx",
	"src/app/admin-next/page.tsx",
	"src/app/admin-next/[domain]/layout.tsx",
	"src/app/admin-next/[domain]/page.tsx",
] as const;

const forbiddenModuleRoots = [
	"src/lib/db",
	"src/lib/auth",
	"src/lib/permissions",
	"src/actions",
	"src/app/actions",
	"src/app/admin",
	"src/app/mod",
	"@prisma/client",
	"drizzle-orm",
	"mysql2",
] as const;

interface BabelNode {
	type: string;
	[key: string]: unknown;
}

interface BabelParser {
	parse(
		source: string,
		options: {
			createImportExpressions: boolean;
			plugins: readonly ["typescript", "jsx"];
			sourceType: "module";
		},
	): BabelNode;
}

interface ModuleAccessScan {
	specifiers: readonly string[];
	violations: readonly string[];
}

const projectRequire = createRequire(import.meta.url);
const requireFromVitest = createRequire(
	projectRequire.resolve("vitest/package.json"),
);
const babelParser = requireFromVitest("@babel/parser") as BabelParser;

const expressionWrapperTypes = new Set([
	"ParenthesizedExpression",
	"TSAsExpression",
	"TSInstantiationExpression",
	"TSNonNullExpression",
	"TSSatisfiesExpression",
	"TSTypeAssertion",
	"TypeCastExpression",
]);
const resolverExtensionPattern = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;

function isBabelNode(value: unknown): value is BabelNode {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

function unwrapModuleArgument(node: unknown): BabelNode | null {
	let current = isBabelNode(node) ? node : null;
	while (current && expressionWrapperTypes.has(current.type)) {
		current = isBabelNode(current.expression) ? current.expression : null;
	}
	return current;
}

function readLiteralModuleSpecifier(node: unknown): string | null {
	const literal = unwrapModuleArgument(node);
	if (!literal) return null;
	if (literal.type === "StringLiteral" && typeof literal.value === "string") {
		return literal.value;
	}
	if (literal.type !== "TemplateLiteral") return null;

	const expressions = Array.isArray(literal.expressions)
		? literal.expressions
		: [];
	const quasis = Array.isArray(literal.quasis) ? literal.quasis : [];
	if (expressions.length !== 0 || quasis.length !== 1) return null;

	const quasi = isBabelNode(quasis[0]) ? quasis[0] : null;
	const value = quasi?.value;
	if (
		typeof value === "object" &&
		value !== null &&
		"cooked" in value &&
		typeof value.cooked === "string"
	) {
		return value.cooked;
	}
	return null;
}

function memberPropertyName(node: BabelNode): string | null {
	const property = unwrapModuleArgument(node.property);
	if (!property) return null;
	if (node.computed === true) return readLiteralModuleSpecifier(property);
	return property.type === "Identifier" && typeof property.name === "string"
		? property.name
		: null;
}

function isGuardedRequireCallee(node: unknown): boolean {
	const callee = unwrapModuleArgument(node);
	if (!callee) return false;
	if (callee.type === "Identifier" && callee.name === "require") return true;
	if (
		callee.type !== "MemberExpression" &&
		callee.type !== "OptionalMemberExpression"
	) {
		return false;
	}

	const object = unwrapModuleArgument(callee.object);
	const property = memberPropertyName(callee);
	return (
		(object?.type === "Identifier" &&
			object.name === "module" &&
			property === "require") ||
		(object?.type === "Identifier" &&
			object.name === "require" &&
			property === "resolve")
	);
}

function scanModuleAccesses(source: string): ModuleAccessScan {
	const root = babelParser.parse(source, {
		createImportExpressions: true,
		plugins: ["typescript", "jsx"],
		sourceType: "module",
	});
	const specifiers: string[] = [];
	const violations: string[] = [];

	function recordArgument(argument: unknown, kind: "import" | "require") {
		const specifier = readLiteralModuleSpecifier(argument);
		if (specifier === null) {
			violations.push(`<non-literal ${kind}>`);
			return;
		}
		specifiers.push(specifier);
	}

	function visit(value: unknown): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!isBabelNode(value)) return;

		if (value.type === "ImportDeclaration") {
			const specifier = readLiteralModuleSpecifier(value.source);
			if (specifier !== null) specifiers.push(specifier);
		} else if (
			(value.type === "ExportNamedDeclaration" ||
				value.type === "ExportAllDeclaration") &&
			value.source !== null
		) {
			const specifier = readLiteralModuleSpecifier(value.source);
			if (specifier !== null) specifiers.push(specifier);
		} else if (value.type === "ImportExpression") {
			recordArgument(value.source, "import");
		} else if (value.type === "TSImportType") {
			recordArgument(value.source ?? value.argument, "import");
		} else if (
			value.type === "CallExpression" ||
			value.type === "OptionalCallExpression"
		) {
			const arguments_ = Array.isArray(value.arguments) ? value.arguments : [];
			if (isBabelNode(value.callee) && value.callee.type === "Import") {
				recordArgument(arguments_[0], "import");
			} else if (isGuardedRequireCallee(value.callee)) {
				recordArgument(arguments_[0], "require");
			}
		} else if (value.type === "TSExternalModuleReference") {
			recordArgument(value.expression, "require");
		}

		for (const [key, child] of Object.entries(value)) {
			if (key !== "type") visit(child);
		}
	}

	visit(root);
	return { specifiers, violations };
}
interface CanonicalLocalSpecifier {
	candidates: readonly string[];
	violation: string | null;
}

function canonicalizeLocalSpecifier(
	routeFile: string,
	specifier: string,
): CanonicalLocalSpecifier {
	const suffixIndex = specifier.search(/[?#]/);
	const withoutSuffix =
		suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);

	let decoded: string;
	try {
		decoded = decodeURIComponent(withoutSuffix).replaceAll("\\", "/");
	} catch {
		return { candidates: [], violation: "<malformed local specifier>" };
	}

	let normalized: string;
	if (decoded.startsWith("@/")) {
		normalized = posix.normalize(`src/${decoded.slice(2)}`);
	} else if (decoded.startsWith(".")) {
		normalized = posix.normalize(posix.join(posix.dirname(routeFile), decoded));
	} else {
		normalized = posix.normalize(decoded);
	}

	const extensionless = normalized.replace(resolverExtensionPattern, "");
	return {
		candidates:
			decoded.startsWith("@/") || decoded.startsWith(".")
				? [...new Set([normalized, extensionless])]
				: [normalized],
		violation: null,
	};
}

function isForbiddenModulePath(path: string): boolean {
	return forbiddenModuleRoots.some(
		(root) => path === root || path.startsWith(`${root}/`),
	);
}

function findRouteImportBoundaryViolations(
	source: string,
	routeFile: string,
): readonly string[] {
	const scan = scanModuleAccesses(source);
	const violations = [...scan.violations];
	const forbiddenPaths: string[] = [];

	for (const specifier of scan.specifiers) {
		const canonical = canonicalizeLocalSpecifier(routeFile, specifier);
		if (canonical.violation) violations.push(canonical.violation);
		const forbiddenPath = canonical.candidates.find(isForbiddenModulePath);
		if (forbiddenPath) forbiddenPaths.push(forbiddenPath);
	}

	return [...violations, ...forbiddenPaths];
}

function capabilityContext(
	granted: readonly string[],
	actor = { id: 42, username: "refreshed-moderator", rank: 3 },
): HousekeepingCapabilityContext {
	const capabilities = new Set(granted);

	return {
		actor,
		isSuperAdmin: false,
		has: (slug) => capabilities.has(slug),
		hasAny: (...slugs) => slugs.some((slug) => capabilities.has(slug)),
		hasAll: (...slugs) => slugs.every((slug) => capabilities.has(slug)),
	};
}

async function renderRoute(route: ReactNode | Promise<ReactNode>) {
	return renderToStaticMarkup(await route);
}

describe("/admin-next preview gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeMocks.env.NODE_ENV = "test";
		routeMocks.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED = true;
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([]),
		);
	});

	it.each([
		["production", false],
		["development", false],
	] as const)("returns 404 for NODE_ENV=%s flag=%s", async (nodeEnv, flag) => {
		routeMocks.env.NODE_ENV = nodeEnv;
		routeMocks.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED = flag;

		await expect(async () =>
			renderRoute(
				AdminNextLayout({
					children: createElement("p", null, "Preview child"),
				}),
			),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("returns 404 in production without the dedicated preview permission", async () => {
		routeMocks.env.NODE_ENV = "production";

		await expect(async () =>
			renderRoute(
				AdminNextLayout({
					children: createElement("p", null, "Preview child"),
				}),
			),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("renders in production for a rank with the dedicated preview permission", async () => {
		routeMocks.env.NODE_ENV = "production";
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext(["housekeeping.preview.access"]),
		);

		const html = await renderRoute(
			AdminNextLayout({
				children: createElement("p", null, "Preview child"),
			}),
		);

		expect(html).toContain("Preview child");
		expect(routeMocks.notFound).not.toHaveBeenCalled();
	});

	it.each(["development", "test"] as const)(
		"renders children in %s when explicitly enabled",
		async (nodeEnv) => {
			routeMocks.env.NODE_ENV = nodeEnv;

			const html = await renderRoute(
				AdminNextLayout({
					children: createElement("p", null, "Preview child"),
				}),
			);

			expect(html).toContain("Preview child");
			expect(routeMocks.notFound).not.toHaveBeenCalled();
		},
	);
});

describe("/admin-next first visible domain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("redirects an administrator to Operations in locked registry order", async () => {
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([PERMS.ADMIN_DASHBOARD, PERMS.USERS_VIEW]),
		);

		await expect(AdminNextPage()).rejects.toThrow(
			"NEXT_REDIRECT:/admin-next/operations",
		);
		expect(routeMocks.redirect).toHaveBeenCalledWith("/admin-next/operations");
		expect(routeMocks.getHousekeepingCapabilityContext).toHaveBeenCalledTimes(
			1,
		);
		expect(routeMocks.getTranslations).not.toHaveBeenCalled();
	});

	it("redirects a moderator with only an approved mod view capability to People", async () => {
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([PERMS.MOD_CFH_VIEW]),
		);

		await expect(AdminNextPage()).rejects.toThrow(
			"NEXT_REDIRECT:/admin-next/people",
		);
		expect(routeMocks.redirect).toHaveBeenCalledWith("/admin-next/people");
		expect(routeMocks.getHousekeepingCapabilityContext).toHaveBeenCalledTimes(
			1,
		);
	});

	it("returns 404 when the operator has no visible domain", async () => {
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([]),
		);

		await expect(AdminNextPage()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.notFound).toHaveBeenCalledTimes(1);
		expect(routeMocks.redirect).not.toHaveBeenCalled();
		expect(routeMocks.getHousekeepingCapabilityContext).toHaveBeenCalledTimes(
			1,
		);
	});
});

describe("/admin-next/[domain] layout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects an unknown domain before loading capability context", async () => {
		await expect(
			AdminNextDomainLayout({
				children: createElement("p", null, "Unknown body"),
				params: Promise.resolve({ domain: "unknown" }),
			}),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.getHousekeepingCapabilityContext).not.toHaveBeenCalled();
		expect(routeMocks.getTranslations).not.toHaveBeenCalled();
	});

	it("rejects a known domain that the operator cannot access", async () => {
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([PERMS.MOD_CFH_VIEW]),
		);

		await expect(
			AdminNextDomainLayout({
				children: createElement("p", null, "Economy body"),
				params: Promise.resolve({ domain: "economy" }),
			}),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.getHousekeepingCapabilityContext).toHaveBeenCalledTimes(
			1,
		);
		expect(routeMocks.getTranslations).not.toHaveBeenCalled();
	});

	it("renders localized People shell from one refreshed capability context", async () => {
		routeMocks.getHousekeepingCapabilityContext.mockResolvedValue(
			capabilityContext([PERMS.MOD_CFH_VIEW]),
		);

		const html = await renderRoute(
			AdminNextDomainLayout({
				children: createElement("p", null, "People body"),
				params: Promise.resolve({ domain: "people" }),
			}),
		);

		expect(html).toContain("refreshed-moderator");
		expect(html).toContain("HK::skip-to-content");
		expect(html).toContain("HK::primary-navigation");
		expect(html).toContain("HK::contextual-navigation");
		expect(html).toContain("HK::command-disabled");
		expect(html).toContain("HK::preview-badge");
		expect(html).toContain("HK::back-to-site");
		expect(html).toContain("HK::people-title");
		expect(html).toContain("People body");
		expect(html).not.toContain("Localized Economy");
		expect(routeMocks.translate).not.toHaveBeenCalledWith(
			"domains.economy.title",
		);
		expect(routeMocks.getHousekeepingCapabilityContext).toHaveBeenCalledTimes(
			1,
		);
		expect(routeMocks.getTranslations).toHaveBeenCalledTimes(1);
	});
});

describe("/admin-next/[domain] page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the real localized manifest and empty state without reloading access", async () => {
		const html = await renderRoute(
			AdminNextDomainPage({
				params: Promise.resolve({ domain: "people" }),
			}),
		);

		expect(html).toContain("HK::people-title");
		expect(html).toContain("Localized People description");
		expect(html).toContain("Localized empty title");
		expect(html).toContain("Localized empty description");
		expect(routeMocks.getHousekeepingCapabilityContext).not.toHaveBeenCalled();
		expect(routeMocks.getTranslations).toHaveBeenCalledTimes(1);
	});

	it("rejects an unknown domain before translating", async () => {
		await expect(
			AdminNextDomainPage({
				params: Promise.resolve({ domain: "unknown" }),
			}),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(routeMocks.getHousekeepingCapabilityContext).not.toHaveBeenCalled();
		expect(routeMocks.getTranslations).not.toHaveBeenCalled();
	});
});

describe("preview route import boundary", () => {
	it("rejects normalized forbidden imports and legacy chrome in real routes", () => {
		for (const path of routeFiles) {
			const source = readFileSync(resolve(process.cwd(), path), "utf8");

			expect(findRouteImportBoundaryViolations(source, path), path).toEqual([]);
			expect(source, path).not.toMatch(/AdminSidebarNav|AdminHubChrome/);
		}
	});

	const interpolationOpen = "$" + "{";

	it.each([
		[
			"relative database import with resolver extension",
			"src/app/admin-next/page.tsx",
			'import db from "../../lib/db.js";',
			"src/lib/db",
		],
		[
			"aliased database import with resolver extension",
			"src/app/admin-next/page.tsx",
			'import db from "@/lib/db.js";',
			"src/lib/db",
		],
		[
			"action root import with resolver extension",
			"src/app/admin-next/page.tsx",
			'import actions from "../../actions.mjs";',
			"src/actions",
		],
		[
			"legacy mod root import with resolver extension",
			"src/app/admin-next/layout.tsx",
			'import mod from "../mod.cjs";',
			"src/app/mod",
		],
		[
			"database import with query suffix",
			"src/app/admin-next/page.tsx",
			'import db from "../../lib/db?server-only";',
			"src/lib/db",
		],
		[
			"action import with hash suffix",
			"src/app/admin-next/page.tsx",
			'import("../../actions/users#server")',
			"src/actions/users",
		],
		[
			"Windows-style relative database import",
			"src/app/admin-next/page.tsx",
			String.raw`import db from "..\\..\\lib\\db";`,
			"src/lib/db",
		],
		[
			"Windows-style aliased database import",
			"src/app/admin-next/page.tsx",
			String.raw`import db from "@\\lib\\db";`,
			"src/lib/db",
		],
		[
			"percent-encoded database import",
			"src/app/admin-next/page.tsx",
			'import db from "../../lib/%64%62";',
			"src/lib/db",
		],
		[
			"optional CommonJS database require",
			"src/app/admin-next/page.tsx",
			'require?.("../../lib/db")',
			"src/lib/db",
		],
		[
			"module database require",
			"src/app/admin-next/page.tsx",
			'module.require("../../lib/db")',
			"src/lib/db",
		],
		[
			"require.resolve database access",
			"src/app/admin-next/page.tsx",
			'require.resolve("../../lib/db")',
			"src/lib/db",
		],
		[
			"optional module database require",
			"src/app/admin-next/page.tsx",
			'module.require?.("../../lib/db")',
			"src/lib/db",
		],
		[
			"optional require.resolve database access",
			"src/app/admin-next/page.tsx",
			'require.resolve?.("../../lib/db")',
			"src/lib/db",
		],
		[
			"TypeScript import-equals database access",
			"src/app/admin-next/page.tsx",
			'import db = require("../../lib/db");',
			"src/lib/db",
		],
		[
			"U+2028 line-continuation database import",
			"src/app/admin-next/page.tsx",
			'import db from "../\\' + "\u2028" + '../lib/db";',
			"src/lib/db",
		],
		[
			"U+2029 line-continuation database import",
			"src/app/admin-next/page.tsx",
			'import db from "../\\' + "\u2029" + '../lib/db";',
			"src/lib/db",
		],
		[
			"parenthesized dynamic action import",
			"src/app/admin-next/page.tsx",
			'import(("../../actions/users"))',
			"src/actions/users",
		],
		[
			"regex-brace template-expression action import",
			"src/app/admin-next/page.tsx",
			`const x = \`${interpolationOpen}/}/.test(value) ? import("../../actions/users") : null}\`;`,
			"src/actions/users",
		],
		[
			"CommonJS database require",
			"src/app/admin-next/page.tsx",
			'require("../../lib/db")',
			"src/lib/db",
		],
		[
			"template-literal dynamic action import",
			"src/app/admin-next/page.tsx",
			"import(`../../actions/users`)",
			"src/actions/users",
		],
		[
			"TypeScript-asserted dynamic action import",
			"src/app/admin-next/page.tsx",
			'import(("../../actions/users" as string))',
			"src/actions/users",
		],
		[
			"template-expression dynamic action import",
			"src/app/admin-next/page.tsx",
			`const x = \`${interpolationOpen}import("../../actions/users")}\`;`,
			"src/actions/users",
		],
		[
			"nested template-expression dynamic action import",
			"src/app/admin-next/[domain]/page.tsx",
			`const x = \`${interpolationOpen}ready ? \`${interpolationOpen}import("../../../actions/nested")}\` : ""}\`;`,
			"src/actions/nested",
		],
		[
			"unicode escaped dynamic app-action import",
			"src/app/admin-next/page.tsx",
			'import("\\u002e\\u002e/actions/users")',
			"src/app/actions/users",
		],
		[
			"code-point escaped dynamic app-action import",
			"src/app/admin-next/page.tsx",
			'import("\\u{2e}\\u{2e}/actions/users")',
			"src/app/actions/users",
		],
		[
			"hex escaped export-from auth import",
			"src/app/admin-next/page.tsx",
			'export * from "\\x2e\\x2e/\\x2e\\x2e/lib/auth";',
			"src/lib/auth",
		],
		[
			"escaped-slash permissions import",
			"src/app/admin-next/page.tsx",
			'import permissions from "..\\/..\\/lib\\/permissions";',
			"src/lib/permissions",
		],
		[
			"unknown escape database import",
			"src/app/admin-next/page.tsx",
			'import db from "../../\\lib/db";',
			"src/lib/db",
		],
		[
			"line-continuation database import",
			"src/app/admin-next/page.tsx",
			'import db from "../\\' + "\n" + '../lib/db";',
			"src/lib/db",
		],
		[
			"aliased database descendant import",
			"src/app/admin-next/page.tsx",
			'import { query } from "@/lib/db/query";',
			"src/lib/db/query",
		],
		[
			"root relative database import",
			"src/app/admin-next/page.tsx",
			'import { db } from "../../lib/db";',
			"src/lib/db",
		],
		[
			"domain relative auth side-effect import",
			"src/app/admin-next/[domain]/layout.tsx",
			'import "../../../lib/auth";',
			"src/lib/auth",
		],
		[
			"domain relative permissions export",
			"src/app/admin-next/[domain]/page.tsx",
			'export { getAdminContext } from "../../../lib/permissions";',
			"src/lib/permissions",
		],
		[
			"root relative action dynamic import",
			"src/app/admin-next/page.tsx",
			'import("../../actions/users")',
			"src/actions/users",
		],
		[
			"root relative app action export",
			"src/app/admin-next/page.tsx",
			'export * from "../actions";',
			"src/app/actions",
		],
		[
			"domain relative legacy admin import",
			"src/app/admin-next/[domain]/layout.tsx",
			'import page from "../../admin/users/page";',
			"src/app/admin/users/page",
		],
		[
			"root relative legacy mod dynamic import",
			"src/app/admin-next/layout.tsx",
			'import("../mod/users/page")',
			"src/app/mod/users/page",
		],
		[
			"Prisma TypeScript import type",
			"src/app/admin-next/page.tsx",
			'type PrismaClient = import("@prisma/client").PrismaClient;',
			"@prisma/client",
		],
		[
			"Drizzle package import",
			"src/app/admin-next/page.tsx",
			'import { sql } from "drizzle-orm";',
			"drizzle-orm",
		],
		[
			"mysql2 package import",
			"src/app/admin-next/page.tsx",
			'import type { Pool } from "mysql2";',
			"mysql2",
		],
	] as const)("detects %s", (_name, routeFile, source, expectedPath) => {
		expect(findRouteImportBoundaryViolations(source, routeFile)).toContain(
			expectedPath,
		);
	});

	it.each([
		[
			"optional CommonJS require",
			"const path = '../../lib/db'; require?.(path)",
			"<non-literal require>",
		],
		[
			"malformed local percent escape",
			'import db from "../../lib/db%ZZ";',
			"<malformed local specifier>",
		],
		[
			"dynamic import",
			"const path = '../../actions/users'; import(path)",
			"<non-literal import>",
		],
		[
			"CommonJS require",
			"const path = '../../lib/db'; require(path)",
			"<non-literal require>",
		],
	] as const)("fails closed for non-literal %s", (_name, source, violation) => {
		expect(
			findRouteImportBoundaryViolations(source, "src/app/admin-next/page.tsx"),
		).toContain(violation);
	});

	it("does not reject substring lookalikes, comments, or ordinary strings", () => {
		const source = [
			'import database from "@/lib/database.js?raw";',
			'import dbTools from "../../lib/db-tools.ts";',
			'import auth from "../../lib/authentication";',
			'import preview from "../admin-next-shared";',
			'import prismaTools from "@prisma/client-tools";',
			'import drizzleTools from "drizzle-orm-kit";',
			'import mysqlTools from "mysql2-wrapper";',
			"const documentation = \"import db from '../../lib/db'\";",
			'const rawTemplate = `import("../../actions/users")`;',
			'// import db from "../../lib/db";',
		].join("\n");

		expect(
			findRouteImportBoundaryViolations(source, "src/app/admin-next/page.tsx"),
		).toEqual([]);
	});
});
