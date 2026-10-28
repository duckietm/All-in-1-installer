import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { EventForm } from "@/app/admin/events/event-form";
import { CmsSettingsForm } from "@/app/admin/settings/cms-settings-form";
import { TicketsTable } from "@/app/admin/tickets/tickets-table";
import { ArticleForm } from "@/components/admin/article-form";
import { FurnitureSyncQueue } from "@/components/admin/studio/furniture-sync-queue";
import { OrganizeImportsLauncher } from "@/components/admin/studio/organize-imports-launcher";
import { StudioClient } from "@/components/admin/studio/studio-client";
import { NotificationCenter } from "@/features/notifications/notification-center";
import type { ArticleSaveResult } from "@/lib/article-input";
import { buildFurniImportSource } from "@/lib/habbo-gamedata-hotel";
import { themePaletteCss } from "@/lib/theme-css";
import { PRESETS } from "@/lib/theme-presets";
import messages from "@/messages/en.json";
import { AttachmentHarness } from "./attachment-harness";
import { DeliveriesHarness } from "./deliveries-harness";
import { FurnitureJobsHarness } from "./furniture-jobs-harness";
import { fixtureAction } from "./server-actions";
import { UnsavedHarness } from "./unsaved-harness";

const theme = document.createElement("style");
theme.textContent = themePaletteCss(
	":root.dark",
	PRESETS["Atom (golden)"].dark,
);
document.head.appendChild(theme);
const route = window.location.pathname;
if (route.includes("notifications")) {
	document.documentElement.classList.add("app");
	document.body.classList.add("site-bg");
	document.body.style.backgroundColor = "var(--color-background)";
}
const root = document.getElementById("root");
if (!root) throw Error("Fixture root missing");
const rows = [
	{
		id: 1,
		subject: "Account assistance",
		creator: "SampleMember",
		creatorId: 7,
		category: "general",
		messages: 2,
		status: "open",
		priority: "normal",
		assignee: "Moderator",
		date: "01/01/2030",
		awaitingStaff: true,
		replyAgeMinutes: 90,
	},
	{
		id: 2,
		subject: "Event question",
		creator: "AnotherMember",
		creatorId: 8,
		category: "events",
		messages: 1,
		status: "waiting",
		priority: "high",
		assignee: "—",
		date: "01/01/2030",
		awaitingStaff: false,
		replyAgeMinutes: 15,
	},
];
const saveArticle = async (form: FormData): Promise<ArticleSaveResult> =>
	fixtureAction("article", Object.fromEntries(form));

function ArticleFixture() {
	const [visible, setVisible] = useState(true);
	return (
		<>
			{route.includes("recovery") && (
				<button type="button" onClick={() => setVisible(false)}>
					Close editor fixture
				</button>
			)}
			{visible && (
				<ArticleForm
					userId={route.includes("recovery") ? "7" : undefined}
					action={saveArticle}
					articleKey="new"
					defaultValues={{
						title: "Community update",
						slug: "community-update",
						image: "/fixture/cover.svg",
						shortStory: "A short update for the community.",
						fullStory:
							"<p>Join the upcoming event and explore the hotel together.</p>",
						status: "draft",
					}}
				/>
			)}
		</>
	);
}

createRoot(root).render(
	<NextIntlClientProvider
		locale="en"
		timeZone="UTC"
		now={new Date("2030-01-01T12:00:00Z")}
		messages={messages}
	>
		<main
			data-admin={route.includes("notifications") ? undefined : ""}
			className={
				route.includes("notifications")
					? "min-w-0 mx-auto max-w-7xl px-3 py-3 md:px-6 md:py-6"
					: "min-w-0 mx-auto max-w-6xl p-5"
			}
		>
			<h1
				hidden={route.includes("notifications")}
				className="mb-5 text-2xl font-bold"
			>
				{route.includes("settings")
					? "CMS settings"
					: route.includes("tickets")
						? "Support desk"
						: route.includes("articles")
							? "News editor"
							: route.includes("deliveries-harness")
								? "Background updates"
								: "Furniture synchronization"}
			</h1>
			{route.includes("notifications") ? (
				<NotificationCenter userId={7} />
			) : route.includes("deliveries-harness") ? (
				<DeliveriesHarness />
			) : route.includes("unsaved-harness") ? (
				<UnsavedHarness />
			) : route.includes("studio-harness") ? (
				<>
					<OrganizeImportsLauncher />
					<StudioClient
						source={buildFurniImportSource("it")}
						defaultTranslate={false}
					/>
				</>
			) : route.includes("attachment-harness") ? (
				<AttachmentHarness />
			) : route.includes("events/recovery") ? (
				<EventForm
					userId="7"
					eventTypes={[
						{ id: 1, name: "Community", slug: "community", color: "#123456" },
					]}
					defaultValues={{
						id: 12,
						title: "Original event",
						description: "Event details",
						typeId: 1,
						status: "draft",
						isRecurring: 0,
						startsAt: new Date("2030-01-01T12:00:00Z"),
					}}
				/>
			) : route.includes("jobs-harness") ? (
				<FurnitureJobsHarness />
			) : route.includes("settings") ? (
				<CmsSettingsForm
					canEdit
					values={{ default_dark: "0", cms_hotel_name: "Example Hotel" }}
				/>
			) : route.includes("tickets") ? (
				<TicketsTable
					data={{ rows, total: 2, page: 1, perPage: 20, lastPage: 1 }}
				/>
			) : route.includes("articles") ? (
				<ArticleFixture />
			) : (
				<FurnitureSyncQueue kind="official" />
			)}
		</main>
		<Toaster />
	</NextIntlClientProvider>,
);
