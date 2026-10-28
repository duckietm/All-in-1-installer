import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HousekeepingNavigationDomain } from "../navigation";
import { HousekeepingShell } from "./housekeeping-shell";

const labels = {
	skipToContent: "Skip to housekeeping content",
	primaryNavigation: "Primary housekeeping navigation",
	contextualNavigation: "Operations navigation",
	command: "Commands are unavailable in preview",
	preview: "Preview",
	backToSite: "Back to site",
};

const domains: readonly HousekeepingNavigationDomain[] = [
	{
		id: "operations",
		href: "/admin-next/operations",
		iconId: "inbox",
		label: "Operations",
		description: "Manage operations",
		items: [
			{ id: "queue", href: "/admin-next/operations/queue", label: "Queue" },
		],
	},
	{
		id: "people",
		href: "/admin-next/people",
		iconId: "users",
		label: "People",
		description: "Manage people",
		items: [],
	},
	{
		id: "content",
		href: "/admin-next/content",
		iconId: "file-text",
		label: "Content",
		description: "Manage content",
		items: [],
	},
	{
		id: "economy",
		href: "/admin-next/economy",
		iconId: "gem",
		label: "Economy",
		description: "Manage economy",
		items: [],
	},
	{
		id: "hotel",
		href: "/admin-next/hotel",
		iconId: "hotel",
		label: "Hotel",
		description: "Manage hotel",
		items: [],
	},
	{
		id: "system",
		href: "/admin-next/system",
		iconId: "settings",
		label: "System",
		description: "Manage system",
		items: [],
	},
];

const taskFiles = [
	"src/features/housekeeping/foundation/shell/housekeeping-shell.tsx",
	"src/features/housekeeping/foundation/shell/domain-rail.tsx",
	"src/features/housekeeping/foundation/shell/context-nav.tsx",
	"src/features/housekeeping/foundation/shell/command-trigger.tsx",
	"src/features/housekeeping/foundation/shell/operator-summary.tsx",
	"src/features/housekeeping/foundation/page/housekeeping-page-shell.tsx",
	"src/features/housekeeping/foundation/page/housekeeping-page-state.tsx",
	"src/features/housekeeping/foundation/shell/housekeeping-shell.test.tsx",
	"src/features/housekeeping/foundation/page/housekeeping-page-state.test.tsx",
] as const;

const componentTaskFiles = taskFiles.slice(0, 7);

const structuralBoundaryRules = [
	{ label: "client directive", pattern: new RegExp("use " + "client") },
	{
		label: "palette color",
		pattern:
			/(?:bg|text|border|from|via|to|ring|outline|fill|stroke|divide|shadow|accent|caret|decoration|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?/,
	},
	{ label: "hex color", pattern: new RegExp("#" + "[0-9a-fA-F]{3,8}") },
	{
		label: "rgb or hsl color",
		pattern: new RegExp("(?:r" + "gb|h" + "sl)\\("),
	},
];

const componentBoundaryRules = [
	{
		label: "React hook",
		pattern: /\b(?:React\.)?use[A-Z]\w*(?:\s*\(|\s*(?:as|,|}))/,
	},
	{ label: "click handler", pattern: /\bonClick\s*=/ },
	{ label: "keyboard handler", pattern: /\bonKey(?:Down|Up|Press)\s*=/ },
	{ label: "executable JSX event prop", pattern: /\bon[A-Z]\w*\s*=/ },
	{ label: "event listener", pattern: new RegExp("addEvent" + "Listener") },
	{
		label: "inline literal color",
		pattern:
			/\bstyle\s*=\s*\{\{[^}]*\b(?:color|background(?:Color)?|borderColor|fill|stroke)\s*:\s*["'](?!var\(--admin-[^)]+\))[^"']+["']/,
	},
	{
		label: "database or action import",
		pattern: new RegExp(
			"(?:from\\s*|import\\s*\\()\\s*['\"][^'\"]*(?:@/lib/" +
				"db|drizzle(?:-orm)?|/" +
				"actions?)[^'\"]*['\"]",
		),
	},
	{ label: "command package", pattern: new RegExp("cmd" + "k", "i") },
	{ label: "localization import", pattern: new RegExp("next" + "-intl") },
	{
		label: "search or mutation runtime",
		pattern: /\b(?:fetch|useQuery|useMutation)\s*\(/,
	},
	{
		label: "persistence storage",
		pattern:
			/\b(?:localStorage|sessionStorage|indexedDB)\b|\.(?:setItem|getItem|removeItem)\s*\(/,
	},
];

function renderShell(
	activeDomainId: HousekeepingNavigationDomain["id"] = "operations",
	availableDomains: readonly HousekeepingNavigationDomain[] = domains,
): string {
	return renderToStaticMarkup(
		<HousekeepingShell
			actor={{ id: 7, username: "Nora", rank: 6 }}
			activeDomainId={activeDomainId}
			domains={availableDomains}
			labels={labels}
		>
			<p>Deck body</p>
		</HousekeepingShell>,
	);
}

function anchors(html: string): readonly string[] {
	return html.match(/<a\b[^>]*>/g) ?? [];
}

function anchorForHref(html: string, href: string): string {
	const anchor = anchors(html).find((candidate) =>
		candidate.includes(`href="${href}"`),
	);
	if (!anchor) throw new Error(`missing anchor for ${href}`);
	return anchor;
}

function boundaryViolations(
	source: string,
	rules: readonly { label: string; pattern: RegExp }[],
): readonly string[] {
	return rules
		.filter((rule) => rule.pattern.test(source))
		.map((rule) => rule.label);
}

describe("HousekeepingShell", () => {
	it("renders the accessible command deck landmarks and supplied shell content", () => {
		const html = renderShell();
		expect(html).toContain('href="#housekeeping-content"');
		expect(html).toContain(">Skip to housekeeping content<");
		expect(html).toContain("<aside");
		expect(html).toContain("<header");
		expect(html).toContain('<nav aria-label="Primary housekeeping navigation"');
		expect(html).toContain('<nav aria-label="Operations navigation"');
		expect(html).toContain('<main id="housekeeping-content"');
		expect(html).toContain(">Deck body</p>");
		expect(html).toContain('href="/admin-next/operations/queue"');
		expect(html).toContain(">Queue<");
		expect(html).toContain(">Nora<");
		expect(html).toContain(">6<");
		expect(html).toContain(">Preview<");
		expect(html).toContain('href="/"');
		expect(html).toContain(">Back to site<");
		expect(html).toMatch(
			/<button type="button" disabled=""[^>]*>Commands are unavailable in preview<\/button>/,
		);
	});

	it("maps all six authorized icons and exactly one active domain", () => {
		const html = renderShell("people");
		const allAnchors = anchors(html);
		const activeAnchors = allAnchors.filter((anchor) =>
			anchor.includes('aria-current="page"'),
		);
		const peopleAnchor = anchorForHref(html, "/admin-next/people");
		for (const iconClass of [
			"lucide-inbox",
			"lucide-users",
			"lucide-file-text",
			"lucide-gem",
			"lucide-hotel",
			"lucide-settings",
		]) {
			expect(html).toContain(`class="lucide ${iconClass}"`);
		}
		expect(activeAnchors).toHaveLength(1);
		expect(peopleAnchor).toContain('aria-current="page"');
		for (const anchor of allAnchors.filter(
			(anchor) => anchor !== peopleAnchor,
		)) {
			expect(anchor).not.toContain('aria-current="page"');
		}
	});

	it("does not throw or render contextual items when a valid active domain is absent", () => {
		const domainsWithoutSystem = domains.filter(
			(domain) => domain.id !== "system",
		);
		expect(() => renderShell("system", domainsWithoutSystem)).not.toThrow();
		const html = renderShell("system", domainsWithoutSystem);
		expect(html).not.toContain('href="/admin-next/operations/queue"');
		expect(html).not.toContain(">Queue<");
	});

	it("keeps Task 10 modules within the server-rendered source boundary", () => {
		for (const path of taskFiles) {
			const source = readFileSync(resolve(process.cwd(), path), "utf8");
			expect(boundaryViolations(source, structuralBoundaryRules)).toEqual([]);
		}
		for (const path of componentTaskFiles) {
			const source = readFileSync(resolve(process.cwd(), path), "utf8");
			expect(boundaryViolations(source, componentBoundaryRules)).toEqual([]);
		}
	});

	it("detects representative prohibited source mutations", () => {
		const componentMutations = [
			["React hook", 'import { useState } from "react";'],
			["click handler", "<button onClick={() => undefined} />"],
			["keyboard handler", "<input onKeyDown={() => undefined} />"],
			[
				"event listener",
				'window.addEventListener("keydown", () => undefined);',
			],
			["database or action import", 'import { db } from "@/lib/db";'],
			["database or action import", 'await import("@/app/actions");'],
			["command package", 'import { Command } from "cmdk";'],
			["localization import", 'import { useTranslations } from "next-intl";'],
			["search or mutation runtime", "useMutation();"],
			["persistence storage", "localStorage.setItem('key', 'value');"],
		] as const;
		for (const [expectedViolation, source] of componentMutations) {
			expect(boundaryViolations(source, componentBoundaryRules)).toContain(
				expectedViolation,
			);
		}
		expect(
			boundaryViolations(
				'const color = "bg-' + 'rose-500";',
				structuralBoundaryRules,
			),
		).toContain("palette color");
		expect(
			boundaryViolations('const color = "#' + 'abc";', structuralBoundaryRules),
		).toContain("hex color");
		expect(
			boundaryViolations(
				'const color = "r' + 'gb(1, 2, 3)";',
				structuralBoundaryRules,
			),
		).toContain("rgb or hsl color");
	});
	it("detects generic hook, event, neutral color, and inline-style mutations", () => {
		const componentMutations = [
			["React hook", "useActionState();"],
			["React hook", 'import { useState as state } from "react";'],
			["React hook", "React.useId();"],
			["executable JSX event prop", "<form onSubmit={() => undefined} />"],
			["executable JSX event prop", "<div onPointerDown={() => undefined} />"],
			["inline literal color", '<div style={{ color: "red" }} />'],
		] as const;

		for (const [expectedViolation, source] of componentMutations) {
			expect(boundaryViolations(source, componentBoundaryRules)).toContain(
				expectedViolation,
			);
		}
		expect(
			boundaryViolations(
				'const color = "bg-' + 'white";',
				structuralBoundaryRules,
			),
		).toContain("palette color");
		expect(
			boundaryViolations(
				'const color = "text-' + 'black";',
				structuralBoundaryRules,
			),
		).toContain("palette color");
	});
	it("detects hard-coded Tailwind color utilities beyond foreground and backgrounds", () => {
		for (const source of [
			'className="ring-' + 'red-500"',
			'className="outline-' + 'blue-500"',
			'className="fill-' + 'green-500"',
			'className="stroke-' + 'purple-500"',
			'className="divide-' + 'amber-400"',
			'className="via-' + 'cyan-500"',
		]) {
			expect(boundaryViolations(source, structuralBoundaryRules)).toContain(
				"palette color",
			);
		}
	});
});
