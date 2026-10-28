import { getTranslations } from "next-intl/server";
import { savePoints } from "@/actions/admin-radio-points";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { siteSettings } from "@/lib/services/site-settings";

export const metadata = { title: "Radio Points" };

const DEFAULTS = {
	radio_points_enabled: "0",
	radio_points_per_minute: "1",
	radio_points_currency: "credits",
	radio_points_max_per_day: "0",
	radio_points_min_listeners: "0",
} as const;

const CURRENCIES = ["credits", "duckets", "diamonds", "points"] as const;

export default async function AdminRadioPointsPage({
	searchParams,
}: {
	searchParams: Promise<{ saved?: string }>;
}) {
	const t = await getTranslations("pages.admin.radio");

	const { saved } = await searchParams;

	const values = {
		radio_points_enabled: await siteSettings
			.get("radio_points_enabled", DEFAULTS.radio_points_enabled)
			.catch(() => DEFAULTS.radio_points_enabled),
		radio_points_per_minute: await siteSettings
			.get("radio_points_per_minute", DEFAULTS.radio_points_per_minute)
			.catch(() => DEFAULTS.radio_points_per_minute),
		radio_points_currency: await siteSettings
			.get("radio_points_currency", DEFAULTS.radio_points_currency)
			.catch(() => DEFAULTS.radio_points_currency),
		radio_points_max_per_day: await siteSettings
			.get("radio_points_max_per_day", DEFAULTS.radio_points_max_per_day)
			.catch(() => DEFAULTS.radio_points_max_per_day),
		radio_points_min_listeners: await siteSettings
			.get("radio_points_min_listeners", DEFAULTS.radio_points_min_listeners)
			.catch(() => DEFAULTS.radio_points_min_listeners),
	};

	const enabled = (values.radio_points_enabled ?? "0") === "1";
	const perMinute =
		values.radio_points_per_minute ?? DEFAULTS.radio_points_per_minute;
	const currency = (values.radio_points_currency ??
		DEFAULTS.radio_points_currency) as string;
	const maxPerDay =
		values.radio_points_max_per_day ?? DEFAULTS.radio_points_max_per_day;
	const minListeners =
		values.radio_points_min_listeners ?? DEFAULTS.radio_points_min_listeners;
	const selectedCurrency = CURRENCIES.includes(
		currency as (typeof CURRENCIES)[number],
	)
		? currency
		: "credits";

	return (
		<main>
			<section className="mt-6">
				{saved === "1" ? (
					<p>
						<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-success-subtle)] text-[var(--admin-text)]">
							{t("pointsForm.saved")}
						</span>
					</p>
				) : null}

				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("pointsForm.points")}
						value={enabled ? t("pointsForm.enabled") : t("pointsForm.disabled")}
						state={enabled ? "ok" : "danger"}
						icon="🎧"
					/>
					<StatusCard
						label={t("pointsForm.perMinute")}
						value={perMinute}
						hint={t("pointsForm.paidIn", { currency: selectedCurrency })}
						icon="⏱️"
					/>
					<StatusCard
						label={t("pointsForm.maxPerDay")}
						value={maxPerDay === "0" ? t("pointsForm.unlimited") : maxPerDay}
						icon="📈"
					/>
					<StatusCard
						label={t("pointsForm.minListeners")}
						value={minListeners}
						icon="👥"
					/>
				</div>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("pointsForm.settings")}</h2>
				<form action={savePoints}>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label
								htmlFor="radio_points_enabled"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("pointsForm.pointsEnabled")}
							</label>
							<select
								id="radio_points_enabled"
								name="radio_points_enabled"
								defaultValue={enabled ? "1" : "0"}
								style={{ width: "100%" }}
							>
								<option value="1">{t("pointsForm.enabled")}</option>
								<option value="0">{t("pointsForm.disabled")}</option>
							</select>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("pointsForm.pointsEnabledHint")}
							</p>
						</div>

						<div>
							<label
								htmlFor="radio_points_currency"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("pointsForm.currency")}
							</label>
							<select
								id="radio_points_currency"
								name="radio_points_currency"
								defaultValue={selectedCurrency}
								style={{ width: "100%" }}
							>
								{CURRENCIES.map((c) => (
									<option key={c} value={c}>
										{c.charAt(0).toUpperCase() + c.slice(1)}
									</option>
								))}
							</select>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("pointsForm.currencyHint")}
							</p>
						</div>

						<div>
							<label
								htmlFor="radio_points_per_minute"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("pointsForm.pointsPerMinute")}
							</label>
							<input
								id="radio_points_per_minute"
								name="radio_points_per_minute"
								type="number"
								min={0}
								step={1}
								defaultValue={perMinute}
								style={{ width: "100%" }}
							/>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("pointsForm.pointsPerMinuteHint")}
							</p>
						</div>

						<div>
							<label
								htmlFor="radio_points_max_per_day"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("pointsForm.maxPerDay")}
							</label>
							<input
								id="radio_points_max_per_day"
								name="radio_points_max_per_day"
								type="number"
								min={0}
								step={1}
								defaultValue={maxPerDay}
								style={{ width: "100%" }}
							/>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("pointsForm.maxPerDayHint")}
							</p>
						</div>

						<div>
							<label
								htmlFor="radio_points_min_listeners"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("pointsForm.minListeners")}
							</label>
							<input
								id="radio_points_min_listeners"
								name="radio_points_min_listeners"
								type="number"
								min={0}
								step={1}
								defaultValue={minListeners}
								style={{ width: "100%" }}
							/>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("pointsForm.minListenersHint")}
							</p>
						</div>
					</div>

					<div className="flex justify-end mt-4">
						<Button type="submit" variant="default">
							{t("pointsForm.save")}
						</Button>
					</div>
				</form>
			</section>
		</main>
	);
}
