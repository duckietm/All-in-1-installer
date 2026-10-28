import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	detectMultiAccounts,
	type MultiAccountCluster,
} from "@/actions/multi-account-detect";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function MultiAccountsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank))
		redirect("/admin");

	const t = await getTranslations("pages.admin.multiAccounts");
	const params = await searchParams;
	const minAccounts = Math.max(2, Number(params.min) || 2);
	const limit = Math.min(200, Number(params.limit) || 50);

	const result = await detectMultiAccounts({ minAccounts, limit });
	const clusters: MultiAccountCluster[] = result.ok
		? ((result.data as { clusters: MultiAccountCluster[] }).clusters ?? [])
		: [];

	return (
		<div className="space-y-6">
			<form className="flex flex-wrap items-end gap-3" action="">
				<label className="text-sm">
					<span className="block text-muted-foreground">
						{t("minAccounts")}
					</span>
					<input
						type="number"
						name="min"
						defaultValue={minAccounts}
						min={2}
						max={50}
						className="mt-1 h-9 w-24 rounded-md border bg-background px-2"
					/>
				</label>
				<label className="text-sm">
					<span className="block text-muted-foreground">
						{t("resultLimit")}
					</span>
					<input
						type="number"
						name="limit"
						defaultValue={limit}
						min={1}
						max={200}
						className="mt-1 h-9 w-24 rounded-md border bg-background px-2"
					/>
				</label>
				<button
					type="submit"
					className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground"
				>
					{t("refresh")}
				</button>
			</form>

			{clusters.length === 0 ? (
				<div className="admin-empty">{t("noClusters")}</div>
			) : (
				<div className="grid gap-4">
					{clusters.map((cluster) => (
						<Card key={cluster.key}>
							<CardHeader className="flex flex-row items-center justify-between space-y-0">
								<CardTitle className="text-base">
									<Badge variant="secondary" className="mr-2">
										{cluster.label}
									</Badge>
									{cluster.accountCount} accounts share this identifier
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{cluster.accounts.map((acc) => (
										<Link
											key={acc.id}
											href={`/admin/users/show/${acc.id}`}
											className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-sm hover:bg-accent"
										>
											<span className="font-medium">{acc.username}</span>
											<span className="text-xs text-muted-foreground">
												#{acc.id}
											</span>
											{acc.rank >= 5 && <Badge variant="outline">staff</Badge>}
											{acc.online === "1" && (
												<span className="h-1.5 w-1.5 rounded-full bg-[var(--admin-success-subtle)]" />
											)}
										</Link>
									))}
									{cluster.accountCount > cluster.accounts.length && (
										<span className="text-xs text-muted-foreground">
											… and {cluster.accountCount - cluster.accounts.length}{" "}
											more
										</span>
									)}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
