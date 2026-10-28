import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { DeliveryCard } from "@/features/operations/delivery-card";
import { deliveryContext } from "@/features/operations/delivery-context";
import {
	deliveryDiagnosticId,
	isDeliveryReference,
} from "@/features/operations/delivery-diagnostics";
import { DeliveryRetry } from "@/features/operations/retry-button";
import { listEffects } from "@/features/operations/server";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
export default async function DeliveryPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank))
		redirect("/admin");
	const editable = canAccess(permissions, PERMS.DEVOPS_EDIT, session.user.rank);
	const access = {
		news: canAccess(permissions, PERMS.NEWS_VIEW, session.user.rank),
		catalog: canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank),
	};
	const t = await getTranslations("pages.admin.deliveries");
	let selectedId: string | undefined;
	let items: Awaited<ReturnType<typeof listEffects>> | null = null;
	try {
		const params = await searchParams;
		selectedId =
			typeof params.id === "string"
				? params.id
				: params.id === undefined
					? undefined
					: "invalid";
		items = await listEffects(selectedId);
	} catch {
		/* Preserve the distinction between unavailable and empty history. */
	}
	const timestamp = (value: Date | string) =>
		value instanceof Date ? value.toISOString() : value;
	return (
		<section className="min-w-0 space-y-4">
			<h1 className="text-2xl font-semibold">{t("title")}</h1>
			<p className="text-muted-foreground">{t("scope")}</p>
			<div className="flex flex-wrap gap-3">
				<Link
					href={
						isDeliveryReference(selectedId)
							? `/admin/devops/deliveries?id=${selectedId}`
							: "/admin/devops/deliveries"
					}
					className="btn btn-outline"
				>
					{t("refresh")}
				</Link>
				{canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank) && (
					<Link href="/admin/operations" className="btn btn-outline">
						{t("openImports")}
					</Link>
				)}
			</div>
			{items === null ? (
				<p role="alert" className="admin-card">
					{t("unavailable")}
				</p>
			) : !items.length ? (
				<p className="admin-card">{t("empty")}</p>
			) : (
				<ul className="space-y-3">
					{items.map((item) => (
						<li key={item.id}>
							<DeliveryCard
								item={{
									id: item.id,
									operationId: item.operationId,
									topic: item.topic,
									status: item.status,
									attempts: item.attempts,
									actorId: item.actorId,
									createdAt: timestamp(item.createdAt),
									availableAt: timestamp(item.availableAt),
									hasError: !!item.lastError,
									errorId: deliveryDiagnosticId(item.lastError),
									context: deliveryContext(item.kind, item.resultJson, access),
								}}
								retry={
									editable && item.status === "failed" ? (
										<DeliveryRetry id={item.id} />
									) : undefined
								}
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
