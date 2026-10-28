import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { db, EmulatorErrors } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";

export default async function EmulatorErrorsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.devops");
	const params = await searchParams;
	const page = Math.max(1, Number(params.page) || 1);
	const perPage = 50;

	const [errors, total] = await Promise.all([
		db
			.select()
			.from(EmulatorErrors)
			.orderBy(desc(EmulatorErrors.id))
			.limit(perPage)
			.offset((page - 1) * perPage),
		getCachedAdminCount(EmulatorErrors, "emulator_errors"),
	]);

	const lastPage = Math.ceil(total / perPage);

	return (
		<div className="space-y-6">
			<a href="/admin/devops/cms-errors" className="btn btn-outline">
				CMS error center
			</a>
			<p className="text-muted-foreground">
				{total} total errors — showing page {page} of {lastPage}
			</p>

			<Card>
				<CardContent className="p-0">
					{errors.length === 0 ? (
						<div className="admin-empty">{t("noEmulatorErrors")}</div>
					) : (
						<div className="divide-y">
							{errors.map((error) => (
								<div key={error.id} className="p-4">
									<div className="flex items-center justify-between mb-2">
										<span className="font-mono text-xs text-muted-foreground">
											#{error.id}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatDate(new Date(error.timestamp * 1000))}
										</span>
									</div>
									<pre className="text-xs whitespace-pre-wrap break-all font-mono bg-muted p-2 rounded">
										{Buffer.from(error.stacktrace).toString("utf-8")}
									</pre>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{lastPage > 1 && (
				<div className="flex justify-center gap-2">
					{page > 1 && (
						<a
							href={`?page=${page - 1}`}
							className="text-sm text-primary hover:underline"
						>
							Previous
						</a>
					)}
					<span className="text-sm text-muted-foreground">
						Page {page} of {lastPage}
					</span>
					{page < lastPage && (
						<a
							href={`?page=${page + 1}`}
							className="text-sm text-primary hover:underline"
						>
							Next
						</a>
					)}
				</div>
			)}
		</div>
	);
}
