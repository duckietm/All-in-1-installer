import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { resolveHotelName } from "@/lib/hotel-name";
import { siteSettings } from "@/lib/services/site-settings";
import { EmbedSnippet } from "./embed-snippet";

export const metadata = { title: "Radio Embed" };

export default async function AdminRadioEmbedPage() {
	const t = await getTranslations("pages.admin.radio");

	let streamUrl = "";
	let radioName = "Radio";
	let nowPlayingApiUrl = "";
	try {
		streamUrl = (await siteSettings.get("radio_stream_url", "")) ?? "";
		radioName =
			(await siteSettings.get("radio_name", null)) ??
			(await resolveHotelName());
		nowPlayingApiUrl =
			(await siteSettings.get("radio_now_playing_api_url", "")) ?? "";
	} catch {
		streamUrl = "";
	}

	streamUrl = streamUrl.trim();
	nowPlayingApiUrl = nowPlayingApiUrl.trim();
	const hasStream = streamUrl !== "";

	const audioSnippet = hasStream
		? `<audio controls preload="none" src="${streamUrl}">\n  ${t("embedPage.audioUnsupported")}\n</audio>`
		: "";

	const iframeSnippet = hasStream
		? `<iframe\n  src="/radio/embed"\n  title="${radioName}"\n  width="320"\n  height="120"\n  frameborder="0"\n  allow="autoplay"\n  style="border:0;border-radius:8px;overflow:hidden"\n></iframe>`
		: "";

	return (
		<main>
			<section className="mt-6">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("embedPage.streamUrl")}
						value={
							hasStream ? t("embedPage.configured") : t("embedPage.missing")
						}
						state={hasStream ? "ok" : "danger"}
						icon="💻"
					/>
					<StatusCard
						label={t("embedPage.radioName")}
						value={radioName}
						icon="🎙️"
					/>
					<StatusCard
						label={t("embedPage.nowPlayingApi")}
						value={
							nowPlayingApiUrl ? t("embedPage.set") : t("embedPage.notSet")
						}
						state={nowPlayingApiUrl ? "ok" : "neutral"}
						icon="🎵"
					/>
				</div>
			</section>

			{!hasStream ? (
				<section className="mt-6">
					<h2 className="admin-section-title">{t("embedPage.noStreamUrl")}</h2>
					<p className="text-xs theme-text-muted dark:theme-text-muted">
						{t("embedPage.noStreamUrlText")}
					</p>
					<p>
						<Button variant="default" asChild>
							<Link href="/admin/radio/settings">
								{t("embedPage.goToSettings")}
							</Link>
						</Button>
					</p>
				</section>
			) : (
				<>
					<section className="mt-6">
						<h2 className="admin-section-title">
							{t("embedPage.livePreview")}
						</h2>
						<p className="text-xs theme-text-muted dark:theme-text-muted">
							{t("embedPage.livePreviewText")}
						</p>
						<div className="admin-card">
							{}
							<audio
								controls
								preload="none"
								src={streamUrl}
								style={{ width: "100%" }}
							>
								<track kind="captions" />
								{t("embedPage.audioUnsupported")}
							</audio>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.5rem 0 0", wordBreak: "break-all" }}
							>
								{t("embedPage.source")}: <code>{streamUrl}</code>
							</p>
						</div>
					</section>

					<EmbedSnippet
						title={t("embedPage.audioSnippet")}
						description={t("embedPage.audioSnippetDesc")}
						snippet={audioSnippet}
					/>

					<EmbedSnippet
						title={t("embedPage.iframeSnippet")}
						description={t("embedPage.iframeSnippetDesc")}
						snippet={iframeSnippet}
					/>
				</>
			)}
		</main>
	);
}
