import { getTranslations } from "next-intl/server";
import { saveProfilePrivacy } from "@/actions/profile-privacy";
import { SurfaceCard } from "@/components/surface-card";
import {
	loadProfilePrivacy,
	profilePrivacyKeys,
} from "@/lib/services/profile-privacy";
export default async function ProfilePrivacySettings({
	userId,
	status,
}: {
	userId: number;
	status?: string;
}) {
	const [privacy, t] = await Promise.all([
		loadProfilePrivacy(userId),
		getTranslations("pages.profile.privacy"),
	]);
	return (
		<section id="profile-privacy">
			<SurfaceCard title={t("title")} bodyClassName="p-5">
				<p className="muted">{t("hint")}</p>
				{status === "saved" && <p role="status">{t("saved")}</p>}
				{(privacy.unavailable || status === "error") && (
					<p role="alert">{t("error")}</p>
				)}
				<form action={saveProfilePrivacy}>
					<fieldset
						disabled={privacy.unavailable}
						style={{
							display: "grid",
							gap: 12,
							margin: "16px 0",
							border: 0,
							padding: 0,
						}}
					>
						<legend className="sr-only">{t("title")}</legend>
						{profilePrivacyKeys.map((key) => (
							<label
								key={key}
								style={{ display: "flex", gap: 10, alignItems: "center" }}
							>
								<input
									type="checkbox"
									name={key}
									defaultChecked={privacy.values[key]}
								/>
								{t(key)}
							</label>
						))}
						<button type="submit" className="btn btn-primary">
							{t("save")}
						</button>
					</fieldset>
				</form>
			</SurfaceCard>
		</section>
	);
}
