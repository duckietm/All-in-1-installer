import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { postThread } from "@/actions/social";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, Guilds } from "@/lib/db";

type SearchParams = Promise<{ error?: string }>;

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export default async function NewThreadPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.guildForumNew");
	const { id } = await params;
	const { error } = await searchParams;
	const guildId = Number(id);
	if (!Number.isInteger(guildId) || guildId <= 0) notFound();

	// Auth gate: only logged-in users may open a thread.
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	// Guild header (read-only). A DB hiccup degrades to notFound rather than 500.
	let guild: { id: number; name: string } | null = null;
	try {
		const [row] = await db
			.select({ id: Guilds.id, name: Guilds.name })
			.from(Guilds)
			.where(eq(Guilds.id, guildId))
			.limit(1);
		guild = row ?? null;
	} catch {
		guild = null;
	}

	if (!guild) notFound();

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "not_found"
				? t("errors.notFound")
				: error === "ratelimit"
					? t("errors.ratelimit")
					: error
						? t("errors.error")
						: null;

	return (
		<section className="page-grid">
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<p style={{ margin: 0 }}>
				<Link href={`/guilds/${guild.id}/forum`}>{t("backToForum")}</Link>
			</p>

			<ContentCard
				icon="✍️"
				title={t("title")}
				subtitle={t("subtitle", { guild: guild.name || t("unnamedGuild") })}
			>
				<form action={postThread}>
					{/* Guild target drives the write; the author is taken from the session
              inside the action, never from this form. */}
					<input type="hidden" name="guildId" value={String(guild.id)} />

					<label htmlFor="thread-subject" className="muted">
						{t("subjectLabel")}
					</label>
					<input
						id="thread-subject"
						name="subject"
						required
						maxLength={255}
						placeholder={t("subjectPlaceholder")}
						style={{ width: "100%", margin: "0.4rem 0 0.9rem" }}
					/>

					<label htmlFor="thread-message" className="muted">
						{t("messageLabel")}
					</label>
					<textarea
						id="thread-message"
						name="message"
						required
						rows={8}
						placeholder={t("messagePlaceholder")}
						style={{
							width: "100%",
							margin: "0.4rem 0 1rem",
							resize: "vertical",
						}}
					/>

					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
						<button type="submit" className="btn btn-primary">
							{t("postThread")}
						</button>
						<Link
							href={`/guilds/${guild.id}/forum`}
							className="btn btn-outline"
						>
							{t("cancel")}
						</Link>
					</div>
				</form>
			</ContentCard>
		</section>
	);
}
