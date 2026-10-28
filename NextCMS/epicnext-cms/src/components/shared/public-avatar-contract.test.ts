import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const compactCallSites = new Map<string, number>([
	["src/components/top-header.tsx", 1],
	// /login and /register render their rosters through this shared frame.
	["src/components/auth/auth-page-frame.tsx", 1],
	["src/app/(site)/friends/page.tsx", 1],
	["src/app/(site)/guilds/[id]/page.tsx", 1],
	["src/app/(site)/leaderboard/page.tsx", 1],
	["src/app/(site)/me/page.tsx", 1],
	["src/app/(site)/messages/page.tsx", 2],
	["src/app/(site)/page.tsx", 1],
	["src/app/(site)/radio/leaderboard/page.tsx", 1],
	["src/app/(site)/radio/shouts/page.tsx", 1],
	["src/app/(site)/rankings/page.tsx", 1],
	["src/app/(site)/search/page.tsx", 1],
	["src/app/(site)/u/[username]/page.tsx", 2],
]);

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public avatar presentation contract", () => {
	it.each([...compactCallSites])(
		"uses the shared thumbnail in %s",
		(path, expectedCount) => {
			const matches = source(path).match(/<UserAvatarThumbnail\b/g) ?? [];
			expect(matches).toHaveLength(expectedCount);
		},
	);

	it("preserves explicit full-avatar previews", () => {
		expect(source("src/app/(site)/me/page.tsx")).toContain(
			"avatarImageUrl(user.look",
		);
		expect(source("src/app/(site)/settings/page.tsx")).toContain(
			"avatarImageUrl(user.look",
		);
		expect(source("src/app/(site)/u/[username]/page.tsx")).toContain(
			"avatarImageUrl(user.look",
		);
	});
});
