import { and, asc, count, like, or, type SQL, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmulatorSettingsForm } from "@/components/admin/emulator-settings-form";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { calcPagination } from "@/lib/admin-helpers";
import { db, EmulatorSettings } from "@/lib/db";

const TRANSLATION_KEY_PATTERNS = [
	"commands.description.",
	"commands.keys.",
	"commands.cmd_",
	"wordfilter.",
	"pet.",
	"matchmaking.",
	"message.",
	"notification.",
] as const;

export default async function EmulatorTranslationsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | undefined>>;
}) {
	const t = await getTranslations("pages.admin.translations.emulator");
	const sp = await searchParams;
	const search = sp.search || "";
	const group = sp.group || "";
	const perPage = Math.min(Math.max(parseInt(sp.perPage || "50", 10), 10), 200);
	const page = Math.max(parseInt(sp.page || "1", 10), 1);

	const patternFilters =
		or(
			...TRANSLATION_KEY_PATTERNS.map((p) =>
				like(EmulatorSettings.key, `${p}%`),
			),
		) ?? sql`1=0`;

	const conditions: SQL[] = [patternFilters];
	if (group) conditions.push(like(EmulatorSettings.key, `${group}.%`));
	if (search) {
		const searchFilter = or(
			like(EmulatorSettings.key, `%${search}%`),
			like(EmulatorSettings.value, `%${search}%`),
		);
		if (searchFilter) conditions.push(searchFilter);
	}
	const where = and(...conditions);

	const [settings, totalRows, allKeys] = await Promise.all([
		db
			.select()
			.from(EmulatorSettings)
			.where(where)
			.orderBy(asc(EmulatorSettings.key))
			.limit(perPage)
			.offset((page - 1) * perPage),
		db.select({ total: count() }).from(EmulatorSettings).where(where),
		db
			.select({ key: EmulatorSettings.key })
			.from(EmulatorSettings)
			.where(patternFilters),
	]);

	const total = Number(totalRows[0]?.total ?? 0);

	const groupCounts = new Map<string, number>();
	for (const { key } of allKeys) {
		const g = key.includes(".") ? key.split(".")[0] : "general";
		groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
	}
	const allGroups = Array.from(groupCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const pagination = calcPagination(total, page, perPage);
	const settingsMap = settings.map((s) => ({ key: s.key, value: s.value }));

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<Button asChild variant="outline" size="sm">
					<Link href="/admin/emulator">
						<ExternalLink className="w-4 h-4 mr-1" />
						{t("fullSettings")}
					</Link>
				</Button>
			</div>

			<div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
				{t("infoBox")}
			</div>

			<EmulatorSettingsForm
				settings={settingsMap}
				pagination={pagination}
				search={search}
				allGroups={allGroups}
				activeGroup={group}
			/>
		</div>
	);
}
