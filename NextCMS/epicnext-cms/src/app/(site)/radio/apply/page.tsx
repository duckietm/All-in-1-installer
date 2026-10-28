import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { applyDj } from "@/actions/radio-apply";
import { ContentCard } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, RadioApplications } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

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

export default async function RadioApplyPage({
	searchParams,
}: {
	searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.radioApply");
	const { submitted, error } = await searchParams;

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "ratelimit"
				? t("errors.ratelimit")
				: error
					? t("errors.error")
					: null;

	const userId = Number(session.user.id);

	// Surface the applicant's most recent application (if any) so they aren't
	// left guessing. Isolated query: a DB hiccup degrades this to null, not 500.
	const [existing] = await db
		.select({
			id: RadioApplications.id,
			status: RadioApplications.status,
			createdAt: RadioApplications.createdAt,
		})
		.from(RadioApplications)
		.where(eq(RadioApplications.userId, BigInt(userId)))
		.orderBy(desc(RadioApplications.id))
		.limit(1)
		.catch(() => []);

	const submittedDate = existing?.createdAt
		? formatDate(existing.createdAt, "date")
		: null;

	return (
		<section className="page-grid">
			{submitted === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.submitted")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard icon="🎤" title={t("title")} subtitle={t("subtitle")} />

			{existing ? (
				<ContentCard icon="📋" title={t("latestTitle")}>
					<p style={{ margin: 0 }}>
						<strong>{t("statusLabel")}</strong> {existing.status}
						{submittedDate ? (
							<span className="muted">
								{" "}
								{t("submittedOn", { date: submittedDate })}
							</span>
						) : null}
					</p>
					<p className="muted" style={{ margin: "0.4rem 0 0" }}>
						{t("submitAgain")}
					</p>
				</ContentCard>
			) : null}

			<ContentCard
				icon="📝"
				title={t("formTitle")}
				subtitle={t("formSubtitle")}
			>
				<form action={applyDj}>
					<div className="card-grid sm-2">
						<div>
							<label htmlFor="realName" className="muted">
								{t("realNameLabel")}
							</label>
							<input
								id="realName"
								name="realName"
								type="text"
								required
								maxLength={255}
								placeholder={t("realNamePlaceholder")}
								style={{ width: "100%", marginTop: "0.3rem" }}
							/>
						</div>
						<div>
							<label htmlFor="age" className="muted">
								{t("ageLabel")}
							</label>
							<input
								id="age"
								name="age"
								type="number"
								required
								min={13}
								max={120}
								placeholder="18"
								style={{ width: "100%", marginTop: "0.3rem" }}
							/>
						</div>
					</div>

					<div style={{ marginTop: "1rem" }}>
						<label htmlFor="availability" className="muted">
							{t("availabilityLabel")}
						</label>
						<textarea
							id="availability"
							name="availability"
							required
							rows={3}
							placeholder={t("availabilityPlaceholder")}
							style={{ width: "100%", marginTop: "0.3rem", resize: "vertical" }}
						/>
					</div>

					<div style={{ marginTop: "1rem" }}>
						<label htmlFor="musicStyle" className="muted">
							{t("musicStyleLabel")}
						</label>
						<input
							id="musicStyle"
							name="musicStyle"
							type="text"
							maxLength={255}
							placeholder={t("musicStylePlaceholder")}
							style={{ width: "100%", marginTop: "0.3rem" }}
						/>
					</div>

					<div style={{ marginTop: "1rem" }}>
						<label htmlFor="experience" className="muted">
							{t("experienceLabel")}{" "}
							<span className="muted">{t("optional")}</span>
						</label>
						<textarea
							id="experience"
							name="experience"
							rows={3}
							placeholder={t("experiencePlaceholder")}
							style={{ width: "100%", marginTop: "0.3rem", resize: "vertical" }}
						/>
					</div>

					<div style={{ marginTop: "1rem" }}>
						<label htmlFor="motivation" className="muted">
							{t("motivationLabel")}
						</label>
						<textarea
							id="motivation"
							name="motivation"
							required
							rows={4}
							placeholder={t("motivationPlaceholder")}
							style={{ width: "100%", marginTop: "0.3rem", resize: "vertical" }}
						/>
					</div>

					<button
						type="submit"
						className="btn btn-primary"
						style={{ marginTop: "1.25rem" }}
					>
						{t("submitButton")}
					</button>
				</form>
			</ContentCard>
		</section>
	);
}
