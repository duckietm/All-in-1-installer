import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	data: {
		support: 2 as number | null,
		friendRequests: 3 as number | null,
		registeredEvent: false as
			| false
			| null
			| { id: number; title: string; startsAt: Date },
	},
}));
vi.mock("@/lib/services/dashboard-tasks", () => ({
	loadDashboardTasks: async () => state.data,
}));
vi.mock("@/components/link", () => ({
	default: ({
		href,
		children,
		...props
	}: {
		href: string;
		children: ReactNode;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("next-intl/server", () => ({
	getTranslations: async () => {
		const messages = JSON.parse(readFileSync("src/messages/it.json", "utf8"))
			.pages.myDashboard.tasks;
		return createTranslator({ locale: "it", messages });
	},
	getFormatter: async () => ({
		dateTime: (date: Date) =>
			new Intl.DateTimeFormat("it", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: "UTC",
			}).format(date),
	}),
}));

import DashboardTasks from "./DashboardTasks";

describe("dashboard task presentation", () => {
	it("renders actionable links from real task data", async () => {
		state.data = {
			support: 2,
			friendRequests: 3,
			registeredEvent: {
				id: 7,
				title:
					"Un evento con un titolo molto lungo per verificare la visualizzazione sullo schermo del telefono",
				startsAt: new Date("2026-09-12T15:00:00Z"),
			},
		};
		const html = renderToStaticMarkup(
			await DashboardTasks({ userId: 42, rewardAvailable: true }),
		);
		expect(html).toContain('href="/help/tickets"');
		expect(html).toContain('href="/friends"');
		expect(html).toContain('href="#referral-reward"');
		expect(html).toContain("-7");
		if (process.env.ACCOUNT_VISUAL_FIXTURE) {
			const css = readFileSync(
				"src/app/(site)/me/dashboard.module.css",
				"utf8",
			).replaceAll(/\.([\w]+)(?=[\s.{:#>])/g, ".$1");
			// Vitest CSS modules are scoped; reproduce those class names for the fixture.
			const taskClass = html.match(/<ul class="([^"]+)"/)?.[1] ?? "tasks";
			const output = join("storage", "account-fixtures");
			mkdirSync(output, { recursive: true });
			writeFileSync(
				join(output, "tasks.html"),
				`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--color-border:#ddd;--color-primary:#a34023;--color-text-muted:#777;--color-surface:#fff}*{box-sizing:border-box}body{font:16px Arial;background:#f7f5f2;margin:0;padding:20px}main{max-width:1000px;margin:auto}a{color:#943712;text-decoration:none}.p-5{padding:20px}.surface-card{border:1px solid #ddd;border-radius:16px;padding:12px}h3{margin:12px}${css.replaceAll(".tasks", `.${taskClass}`)}</style><main>${html}<div id="referral-reward">Premio inviti</div></main></html>`,
			);
		}
	});
	it("shows an honest empty state only after successful queries", async () => {
		state.data = { support: 0, friendRequests: 0, registeredEvent: false };
		expect(
			renderToStaticMarkup(
				await DashboardTasks({ userId: 42, rewardAvailable: false }),
			),
		).toContain("Nessuna azione");
		state.data = { support: null, friendRequests: null, registeredEvent: null };
		const html = renderToStaticMarkup(
			await DashboardTasks({ userId: 42, rewardAvailable: null }),
		);
		expect(html).toContain('role="status"');
		expect(html).not.toContain("Nessuna azione");
	});
});
