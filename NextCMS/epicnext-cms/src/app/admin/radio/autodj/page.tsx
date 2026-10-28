import { asc } from "drizzle-orm";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import {
	createTrack,
	deleteTrack,
	toggleTrack,
} from "@/actions/admin-radio-autodj";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioAutoDjPlaylist } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export const metadata = { title: "Radio AutoDJ" };

type Track = {
	id: bigint;
	title: string;
	artist: string | null;
	album: string | null;
	artworkUrl: string | null;
	duration: number | null;
	playCount: number;
	lastPlayedAt: Date | null;
	isActive: boolean;
	sortOrder: number;
};

function formatDuration(seconds: number | null): string {
	if (seconds == null || seconds < 0) return "\u2014";
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function AdminRadioAutoDjPage() {
	const t = await getTranslations("pages.admin.radio");

	let tracks: Track[] = [];
	let dbError = false;

	try {
		tracks = await db
			.select({
				id: RadioAutoDjPlaylist.id,
				title: RadioAutoDjPlaylist.title,
				artist: RadioAutoDjPlaylist.artist,
				album: RadioAutoDjPlaylist.album,
				artworkUrl: RadioAutoDjPlaylist.artworkUrl,
				duration: RadioAutoDjPlaylist.duration,
				playCount: RadioAutoDjPlaylist.playCount,
				lastPlayedAt: RadioAutoDjPlaylist.lastPlayedAt,
				isActive: RadioAutoDjPlaylist.isActive,
				sortOrder: RadioAutoDjPlaylist.sortOrder,
			})
			.from(RadioAutoDjPlaylist)
			.orderBy(
				asc(RadioAutoDjPlaylist.sortOrder),
				asc(RadioAutoDjPlaylist.title),
			)
			.catch(() => {
				dbError = true;
				return [];
			});
	} catch {
		dbError = true;
		tracks = [];
	}

	const activeCount = tracks.filter((t) => t.isActive).length;
	const inactiveCount = tracks.length - activeCount;

	return (
		<main>
			<section className="mt-6">
				{dbError ? (
					<div className="admin-card mb-6">
						<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
							{t("autoDjForm.dbError")}
						</p>
					</div>
				) : (
					<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
						<StatusCard
							label={t("autoDjForm.tracks")}
							value={tracks.length}
							icon="🎵"
						/>
						<StatusCard
							label={t("autoDjForm.active")}
							value={activeCount}
							state={activeCount > 0 ? "ok" : "neutral"}
							icon="▶️"
						/>
						<StatusCard
							label={t("autoDjForm.inactive")}
							value={inactiveCount}
							state={inactiveCount > 0 ? "warn" : "neutral"}
							icon="⏸️"
						/>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("autoDjForm.addTrack")}</h2>
				<form action={createTrack} className="admin-card">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label
								htmlFor="new_title"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.trackTitle")}
							</label>
							<input
								id="new_title"
								name="title"
								placeholder={t("autoDjForm.titlePlaceholder")}
								required
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_artist"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.artist")}
							</label>
							<input id="new_artist" name="artist" style={{ width: "100%" }} />
						</div>
						<div>
							<label
								htmlFor="new_album"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.album")}
							</label>
							<input id="new_album" name="album" style={{ width: "100%" }} />
						</div>
						<div>
							<label
								htmlFor="new_artworkUrl"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.artworkUrl")}
							</label>
							<input
								id="new_artworkUrl"
								name="artworkUrl"
								placeholder={t("autoDjForm.artworkUrlPlaceholder")}
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_duration"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.duration")}
							</label>
							<input
								id="new_duration"
								name="duration"
								type="number"
								min={0}
								placeholder={t("autoDjForm.durationPlaceholder")}
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_sortOrder"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("autoDjForm.sortOrder")}
							</label>
							<input
								id="new_sortOrder"
								name="sortOrder"
								type="number"
								defaultValue={0}
								style={{ width: "100%" }}
							/>
						</div>
						<div style={{ display: "flex", alignItems: "flex-end" }}>
							<label
								style={{
									display: "inline-flex",
									gap: "0.4rem",
									alignItems: "center",
								}}
							>
								<input
									type="checkbox"
									name="isActive"
									value="1"
									defaultChecked
								/>{" "}
								{t("autoDjForm.active")}
							</label>
						</div>
					</div>
					<div style={{ marginTop: "0.75rem" }}>
						<Button type="submit" variant="default">
							{t("autoDjForm.addTrack")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("autoDjForm.playlist", { count: tracks.length })}
				</h2>
				{tracks.length === 0 ? (
					<div className="admin-empty">{t("autoDjForm.noTracks")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("autoDjForm.colOrder")}</th>
									<th>{t("autoDjForm.colTitle")}</th>
									<th>{t("autoDjForm.colArtist")}</th>
									<th>{t("autoDjForm.colAlbum")}</th>
									<th>{t("autoDjForm.colDuration")}</th>
									<th>{t("autoDjForm.colPlays")}</th>
									<th>{t("autoDjForm.colLastPlayed")}</th>
									<th>{t("autoDjForm.colStatus")}</th>
									<th>{t("autoDjForm.colActions")}</th>
								</tr>
							</thead>
							<tbody>
								{tracks.map((track) => (
									<tr key={String(track.id)}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{track.sortOrder}
										</td>
										<td>
											<span className="inline-flex gap-2 items-center">
												{track.artworkUrl ? (
													<Image
														src={track.artworkUrl}
														alt=""
														width={32}
														height={32}
														style={{ borderRadius: 4, objectFit: "cover" }}
														unoptimized
													/>
												) : null}
												<strong>{track.title}</strong>
											</span>
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{track.artist ?? "\u2014"}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{track.album ?? "\u2014"}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDuration(track.duration)}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{track.playCount}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(track.lastPlayedAt, "datetime", "\u2014")}
										</td>
										<td>
											<span
												className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${track.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
											>
												{track.isActive
													? t("autoDjForm.activeLabel")
													: t("autoDjForm.inactiveLabel")}
											</span>
										</td>
										<td>
											<div
												style={{
													display: "flex",
													gap: "0.4rem",
													flexWrap: "wrap",
												}}
											>
												<form action={toggleTrack}>
													<input
														type="hidden"
														name="id"
														value={String(track.id)}
													/>
													<input
														type="hidden"
														name="isActive"
														value={track.isActive ? "0" : "1"}
													/>
													<Button type="submit" variant="outline">
														{track.isActive
															? t("autoDjForm.deactivate")
															: t("autoDjForm.activate")}
													</Button>
												</form>
												<form action={deleteTrack}>
													<input
														type="hidden"
														name="id"
														value={String(track.id)}
													/>
													<Button type="submit" variant="destructive">
														{t("autoDjForm.delete")}
													</Button>
												</form>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
