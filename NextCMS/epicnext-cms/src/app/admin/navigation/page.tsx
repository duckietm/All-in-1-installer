import { asc, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import {
	db,
	NavigatorFlatcats,
	NavigatorPubliccats,
	queryRows,
	Rooms,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

// navigator_flatcats — emulator-owned flat (private-room) categories shown in the
// navigator.
type Flatcat = {
	id: number;
	caption: string;
	captionSave: string;
	minRank: number;
	maxUserCount: number;
	canTrade: string;
	public: string;
	listType: number;
	orderNum: number;
};

// navigator_publics — keyless table, read via raw SQL.
type PublicRow = {
	public_cat_id: number;
	room_id: number;
	visible: string;
};

function YesNo({ on }: { on: boolean }) {
	return (
		<span
			className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${on ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
		>
			{on ? "Yes" : "No"}
		</span>
	);
}

export default async function AdminNavigation() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.navigation");
	let flatcats: Flatcat[] = [];
	try {
		flatcats = await db
			.select({
				id: NavigatorFlatcats.id,
				caption: NavigatorFlatcats.caption,
				captionSave: NavigatorFlatcats.captionSave,
				minRank: NavigatorFlatcats.minRank,
				maxUserCount: NavigatorFlatcats.maxUserCount,
				canTrade: NavigatorFlatcats.canTrade,
				public: NavigatorFlatcats.public,
				listType: NavigatorFlatcats.listType,
				orderNum: NavigatorFlatcats.orderNum,
			})
			.from(NavigatorFlatcats)
			.orderBy(asc(NavigatorFlatcats.orderNum), asc(NavigatorFlatcats.id));
	} catch {
		flatcats = [];
	}

	let publics: PublicRow[] = [];
	try {
		publics = await queryRows<PublicRow>(sql`
      SELECT public_cat_id, room_id, visible
      FROM navigator_publics
      ORDER BY public_cat_id ASC, room_id ASC
    `);
	} catch {
		publics = [];
	}

	const catIds = Array.from(new Set(publics.map((p) => p.public_cat_id)));
	const roomIds = Array.from(new Set(publics.map((p) => p.room_id)));

	let catNameById = new Map<number, string>();
	if (catIds.length) {
		try {
			const cats = await db
				.select({ id: NavigatorPubliccats.id, name: NavigatorPubliccats.name })
				.from(NavigatorPubliccats)
				.where(inArray(NavigatorPubliccats.id, catIds));
			catNameById = new Map(cats.map((c) => [c.id, c.name]));
		} catch {
			catNameById = new Map();
		}
	}

	let roomNameById = new Map<number, string>();
	if (roomIds.length) {
		try {
			const rooms = await db
				.select({ id: Rooms.id, name: Rooms.name })
				.from(Rooms)
				.where(inArray(Rooms.id, roomIds));
			roomNameById = new Map(rooms.map((r) => [r.id, r.name]));
		} catch {
			roomNameById = new Map();
		}
	}

	const publicFlatcats = flatcats.filter((c) => c.public === "1").length;
	const visiblePublics = publics.filter((p) => p.visible === "1").length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("flatCategories")}
					value={flatcats.length}
					icon="📂"
				/>
				<StatusCard
					label={t("publicFlatcats")}
					value={publicFlatcats}
					hint={t("markedPublic")}
					icon="🌐"
				/>
				<StatusCard label={t("publicRooms")} value={publics.length} icon="🚪" />
				<StatusCard
					label={t("visibleRooms")}
					value={visiblePublics}
					state={visiblePublics > 0 ? "ok" : "neutral"}
					icon="👁️"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("flatCategories")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					<code>navigator_flatcats</code> · {flatcats.length} {t("rows")}
				</p>
				{flatcats.length === 0 ? (
					<div className="admin-empty">{t("noCategories")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("colId")}</th>
									<th>Caption</th>
									<th>Caption (save)</th>
									<th>Min rank</th>
									<th>Max users</th>
									<th>Can trade</th>
									<th>Public</th>
									<th>List type</th>
									<th>{t("colOrder")}</th>
								</tr>
							</thead>
							<tbody>
								{flatcats.map((c) => (
									<tr key={c.id}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{c.id}
										</td>
										<td>{c.caption || "—"}</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{c.captionSave || "—"}
										</td>
										<td>{c.minRank}</td>
										<td>{c.maxUserCount}</td>
										<td>
											<YesNo on={c.canTrade === "1"} />
										</td>
										<td>
											<YesNo on={c.public === "1"} />
										</td>
										<td>{c.listType}</td>
										<td>{c.orderNum}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("publicRooms")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					<code>navigator_publics</code> · {publics.length} {t("rows")}
				</p>
				{publics.length === 0 ? (
					<div className="admin-empty">{t("noPublicRooms")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>Public cat</th>
									<th>{t("colName")}</th>
									<th>Visible</th>
								</tr>
							</thead>
							<tbody>
								{publics.map((p) => (
									<tr key={`${p.public_cat_id}-${p.room_id}`}>
										<td>
											{catNameById.get(p.public_cat_id) ?? "—"}{" "}
											<span className="text-sm theme-text-muted dark:theme-text-muted">
												#{p.public_cat_id}
											</span>
										</td>
										<td>
											{roomNameById.get(p.room_id) || t("unnamed")}{" "}
											<span className="text-sm theme-text-muted dark:theme-text-muted">
												#{p.room_id}
											</span>
										</td>
										<td>
											<YesNo on={p.visible === "1"} />
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
