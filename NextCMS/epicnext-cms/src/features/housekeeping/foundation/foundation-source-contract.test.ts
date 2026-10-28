import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOUSEKEEPING_MANIFESTS } from "../manifests";
import { discoverLegacyPages } from "../migration/discover-legacy-pages";
import { HOUSEKEEPING_MIGRATION_MATRIX } from "../migration/matrix";
import { validateMigrationEntries } from "../migration/validate-matrix";
import { isHousekeepingPreviewEnabled } from "./preview-gate";
import { createHousekeepingRegistry } from "./registry";
import { CommandTrigger } from "./shell/command-trigger";

const HOUSEKEEPING_ROOT = "src/features/housekeeping";
const SERVER_CAPABILITY_CONTEXT =
	"src/features/housekeeping/foundation/server-capability-context.ts";
const PERMISSIONS_ADAPTER = "src/lib/permissions";
const DOMAIN_MODULE_ROOT = "src/features/housekeeping/domains";
const forbiddenModuleRoots = [
	"src/lib/db",
	"src/lib/db-pool",
	"src/lib/cached-db",
	"src/db",
	"src/generated/prisma",
	"src/actions",
	"src/app/actions",
	"src/lib/auth",
	"src/app/admin",
	"src/app/mod",
	"@prisma/client",
	"drizzle-orm",
	"mysql2",
	"cmdk",
] as const;
const resolverExtensionPattern = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;

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

interface ModuleAccess {
	kind: "import" | "export" | "runtime";
	importedNames: readonly string[];
	specifier: string;
	typeOnly: boolean;
}

interface ModuleAccessScan {
	accesses: readonly ModuleAccess[];
	violations: readonly string[];
}

interface CanonicalModuleSpecifier {
	candidates: readonly string[];
	violation: string | null;
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

function runtimeSourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return runtimeSourceFiles(path);
			if (
				!/\.(?:ts|tsx)$/.test(entry.name) ||
				entry.name.endsWith(".test.ts") ||
				entry.name.endsWith(".test.tsx")
			) {
				return [];
			}

			return [path.replaceAll("\\", "/")];
		})
		.sort((a, b) => a.localeCompare(b));
}

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
	return typeof value === "object" &&
		value !== null &&
		"cooked" in value &&
		typeof value.cooked === "string"
		? value.cooked
		: null;
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

function isTypeOnlyDeclaration(
	node: BabelNode,
	kind: "importKind" | "exportKind",
): boolean {
	if (node[kind] === "type" || node[kind] === "typeof") return true;

	const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
	return (
		specifiers.length > 0 &&
		specifiers.every((specifier) => {
			const declaration = isBabelNode(specifier) ? specifier : null;
			return (
				declaration?.importKind === "type" || declaration?.exportKind === "type"
			);
		})
	);
}
function namedImportNames(node: BabelNode): readonly string[] {
	const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];

	return specifiers.flatMap((specifier) => {
		const declaration = isBabelNode(specifier) ? specifier : null;
		if (declaration?.type !== "ImportSpecifier") return [];

		const imported = unwrapModuleArgument(declaration.imported);
		if (imported?.type === "Identifier" && typeof imported.name === "string") {
			return [imported.name];
		}
		return imported?.type === "StringLiteral" &&
			typeof imported.value === "string"
			? [imported.value]
			: [];
	});
}
function scanModuleAccesses(source: string): ModuleAccessScan {
	const root = babelParser.parse(source, {
		createImportExpressions: true,
		plugins: ["typescript", "jsx"],
		sourceType: "module",
	});
	const accesses: ModuleAccess[] = [];
	const violations: string[] = [];

	function recordArgument(argument: unknown, kind: "import" | "require") {
		const specifier = readLiteralModuleSpecifier(argument);
		if (specifier === null) {
			violations.push(`<non-literal ${kind}>`);
			return;
		}
		accesses.push({
			kind: "runtime",
			importedNames: [],
			specifier,
			typeOnly: false,
		});
	}

	function visit(value: unknown): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!isBabelNode(value)) return;

		if (value.type === "ImportDeclaration") {
			const specifier = readLiteralModuleSpecifier(value.source);
			if (specifier !== null) {
				accesses.push({
					kind: "import",
					importedNames: namedImportNames(value),
					specifier,
					typeOnly: isTypeOnlyDeclaration(value, "importKind"),
				});
			}
		} else if (
			(value.type === "ExportNamedDeclaration" ||
				value.type === "ExportAllDeclaration") &&
			value.source !== null
		) {
			const specifier = readLiteralModuleSpecifier(value.source);
			if (specifier !== null) {
				accesses.push({
					kind: "export",
					importedNames: [],
					specifier,
					typeOnly: isTypeOnlyDeclaration(value, "exportKind"),
				});
			}
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
	return { accesses, violations };
}

function canonicalizeModuleSpecifier(
	sourceFile: string,
	specifier: string,
): CanonicalModuleSpecifier {
	const suffixIndex = specifier.search(/[?#]/);
	const withoutSuffix =
		suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);

	let decoded: string;
	try {
		decoded = decodeURIComponent(withoutSuffix).replaceAll("\\", "/");
	} catch {
		return { candidates: [], violation: "<malformed module specifier>" };
	}

	let normalized: string;
	if (decoded.startsWith("@/")) {
		normalized = posix.normalize(`src/${decoded.slice(2)}`);
	} else if (decoded.startsWith(".")) {
		normalized = posix.normalize(
			posix.join(posix.dirname(sourceFile), decoded),
		);
	} else {
		normalized = posix.normalize(decoded);
	}

	return {
		candidates: [normalized.replace(resolverExtensionPattern, "")],
		violation: null,
	};
}

function isAtOrBelow(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function isDomainWorkflowModule(path: string): boolean {
	if (!isAtOrBelow(path, DOMAIN_MODULE_ROOT)) return false;
	return !/^src\/features\/housekeeping\/domains\/[^/]+\/manifest$/.test(path);
}

function isForbiddenModulePath(path: string, sourceFile: string): boolean {
	if (isAtOrBelow(path, PERMISSIONS_ADAPTER)) {
		return !(
			sourceFile === SERVER_CAPABILITY_CONTEXT && path === PERMISSIONS_ADAPTER
		);
	}
	return (
		forbiddenModuleRoots.some((root) => isAtOrBelow(path, root)) ||
		isDomainWorkflowModule(path)
	);
}
function isAllowedPermissionSetTypeImport(
	access: ModuleAccess,
	canonical: CanonicalModuleSpecifier,
	sourceFile: string,
): boolean {
	return (
		sourceFile ===
			"src/features/housekeeping/foundation/capability-context.ts" &&
		access.kind === "import" &&
		access.typeOnly &&
		access.importedNames.length === 1 &&
		access.importedNames[0] === "PermissionSet" &&
		canonical.candidates.includes(PERMISSIONS_ADAPTER)
	);
}

function findHousekeepingImportBoundaryViolations(
	source: string,
	sourceFile: string,
): readonly string[] {
	const scan = scanModuleAccesses(source);
	const violations = [...scan.violations];

	for (const access of scan.accesses) {
		const canonical = canonicalizeModuleSpecifier(sourceFile, access.specifier);
		if (canonical.violation) violations.push(canonical.violation);
		if (isAllowedPermissionSetTypeImport(access, canonical, sourceFile))
			continue;
		const forbiddenPath = canonical.candidates.find((candidate) =>
			isForbiddenModulePath(candidate, sourceFile),
		);
		if (forbiddenPath) violations.push(forbiddenPath);
	}

	return violations;
}
function executablePropNames(element: ReactElement): readonly string[] {
	const props = element.props;
	if (typeof props !== "object" || props === null) return [];

	return Object.entries(props).flatMap(([name, value]) =>
		/^on/i.test(name) && typeof value === "function" ? [name] : [],
	);
}

describe("housekeeping runtime import boundary", () => {
	it("keeps every runtime module inside the foundation boundary", () => {
		for (const sourceFile of runtimeSourceFiles(HOUSEKEEPING_ROOT)) {
			const source = readFileSync(sourceFile, "utf8");
			expect(
				findHousekeepingImportBoundaryViolations(source, sourceFile),
				sourceFile,
			).toEqual([]);
		}
	});

	it.each([
		[
			"aliased database import",
			"src/features/housekeeping/foundation/registry.ts",
			'import { db } from "@/lib/db";',
			"src/lib/db",
		],
		[
			"aliased type-only database import",
			"src/features/housekeeping/foundation/registry.ts",
			'import type { Database } from "@/lib/db";',
			"src/lib/db",
		],
		[
			"aliased type-only action export",
			"src/features/housekeeping/foundation/registry.ts",
			'export type { ActionInput } from "@/actions/users";',
			"src/actions/users",
		],
		[
			"relative action import",
			"src/features/housekeeping/foundation/registry.ts",
			'import action from "../../../actions/users";',
			"src/actions/users",
		],
		[
			"direct auth export",
			"src/features/housekeeping/foundation/registry.ts",
			'export * from "@/lib/auth";',
			"src/lib/auth",
		],
		[
			"legacy route import",
			"src/features/housekeeping/foundation/registry.ts",
			'import page from "../../../app/admin/users/page";',
			"src/app/admin/users/page",
		],
		[
			"command package import",
			"src/features/housekeeping/foundation/registry.ts",
			'import { Command } from "cmdk";',
			"cmdk",
		],
		[
			"domain workflow import",
			"src/features/housekeeping/foundation/registry.ts",
			'import workflow from "../domains/people/workflow";',
			"src/features/housekeeping/domains/people/workflow",
		],
		[
			"TypeScript import type database access",
			"src/features/housekeeping/foundation/registry.ts",
			'type PrismaClient = import("@prisma/client").PrismaClient;',
			"@prisma/client",
		],
	] as const)("detects %s", (_name, sourceFile, source, expectedPath) => {
		expect(
			findHousekeepingImportBoundaryViolations(source, sourceFile),
		).toContain(expectedPath);
	});

	it.each([
		[
			"dynamic import",
			"const modulePath = '@/lib/db'; import(modulePath);",
			"<non-literal import>",
		],
		[
			"CommonJS require",
			"const modulePath = '@/actions/users'; require(modulePath);",
			"<non-literal require>",
		],
	] as const)(
		"fails closed for a non-literal %s",
		(_name, source, expected) => {
			expect(
				findHousekeepingImportBoundaryViolations(
					source,
					"src/features/housekeeping/foundation/registry.ts",
				),
			).toContain(expected);
		},
	);

	it("allows only the server capability adapter to import permissions", () => {
		const runtimeSource =
			'import { getAdminContext } from "@/lib/permissions";';
		const typeOnlySource =
			'import type { PermissionSet } from "@/lib/permissions";';

		expect(
			findHousekeepingImportBoundaryViolations(
				typeOnlySource,
				"src/features/housekeeping/foundation/capability-context.ts",
			),
		).toEqual([]);
		expect(
			findHousekeepingImportBoundaryViolations(
				runtimeSource,
				SERVER_CAPABILITY_CONTEXT,
			),
		).toEqual([]);
		expect(
			findHousekeepingImportBoundaryViolations(
				runtimeSource,
				"src/features/housekeeping/foundation/capability-context.ts",
			),
		).toContain(PERMISSIONS_ADAPTER);
		expect(
			findHousekeepingImportBoundaryViolations(
				'import adapter from "@/lib/permissions/internal";',
				SERVER_CAPABILITY_CONTEXT,
			),
		).toContain("src/lib/permissions/internal");
	});
	it("allows harmless lookalikes and the declared domain manifests", () => {
		const source = [
			'import database from "@/lib/database";',
			'import authentication from "@/lib/authentication";',
			'import commandKit from "cmdkit";',
			'import manifest from "./domains/people/manifest";',
			"const documentation = \"import db from '@/lib/db'\";",
			'// import action from "@/actions/users";',
		].join("\n");

		expect(
			findHousekeepingImportBoundaryViolations(
				source,
				"src/features/housekeeping/manifests.ts",
			),
		).toEqual([]);
	});

	it("allows a harmless type-only module lookalike", () => {
		expect(
			findHousekeepingImportBoundaryViolations(
				'import type { DatabaseDocument } from "@/lib/database";',
				"src/features/housekeeping/manifests.ts",
			),
		).toEqual([]);
	});

	it("allows a normalized domain manifest with a resolver extension", () => {
		expect(
			findHousekeepingImportBoundaryViolations(
				'import manifest from "./domains/people/manifest.ts";',
				"src/features/housekeeping/manifests.ts",
			),
		).toEqual([]);
	});
});

describe("housekeeping foundation completion contracts", () => {
	it("leaves the current and preview route entrypoints present", () => {
		for (const path of [
			"src/app/admin/layout.tsx",
			"src/app/mod/layout.tsx",
			"src/app/admin-next/layout.tsx",
		]) {
			expect(existsSync(path), path).toBe(true);
		}
	});

	it("creates the real six-domain registry in locked order without approved workflows", () => {
		const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);

		expect(registry.domains.map((domain) => domain.id)).toEqual([
			"operations",
			"people",
			"content",
			"economy",
			"hotel",
			"system",
		]);
		expect(
			registry.domains
				.filter((domain) => domain.id !== "hotel")
				.every((domain) => domain.routes.length === 0),
		).toBe(true);
		expect(
			registry.domains.find((domain) => domain.id === "hotel")?.routes,
		).toEqual([
			expect.objectContaining({
				id: "theme-manager",
				href: "/admin-next/hotel/theme-manager",
				labelKey: "pages.housekeeping.domains.hotel.routes.themeManager",
			}),
			expect.objectContaining({
				id: "nitro-cleanup",
				href: "/admin-next/hotel/nitro-cleanup",
				labelKey: "pages.housekeeping.domains.hotel.routes.nitroCleanup",
			}),
		]);
	});

	it("keeps production preview disabled even when the flag is true", () => {
		expect(
			isHousekeepingPreviewEnabled({ nodeEnv: "production", flag: true }),
		).toBe(false);
	});

	it("detects executable React props before markup serialization", () => {
		const mutatedTrigger = createElement(
			"button",
			{ onClick: () => undefined, type: "button" },
			"mutation witness",
		);

		expect(executablePropNames(mutatedTrigger)).toEqual(["onClick"]);
	});

	it("renders one inert localized command affordance", () => {
		const sentinel = "HK::comando-localizzato-disabilitato";
		const trigger = CommandTrigger({ label: sentinel });
		const html = renderToStaticMarkup(trigger);
		const buttons = html.match(/<button\b[^>]*>/g) ?? [];
		expect(executablePropNames(trigger)).toEqual([]);

		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toMatch(/\sdisabled(?:=""|(?=\s|>))/);
		expect(html).toContain(`>${sentinel}</button>`);
	});

	it("validates the complete 147-row migration matrix without issues", () => {
		const discovered = discoverLegacyPages();
		const issues = validateMigrationEntries(
			discovered,
			HOUSEKEEPING_MIGRATION_MATRIX,
		);

		expect(HOUSEKEEPING_MIGRATION_MATRIX).toHaveLength(147);
		expect(discovered).toHaveLength(147);
		expect(issues).toEqual([]);
	});
});
