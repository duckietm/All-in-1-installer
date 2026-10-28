import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
	DeliveryCard,
	type DeliveryCardItem,
} from "@/features/operations/delivery-card";
import { deliveryContext } from "@/features/operations/delivery-context";

const shared: Omit<DeliveryCardItem, "id" | "operationId" | "context"> = {
	topic: "news.refresh",
	status: "pending",
	attempts: 2,
	actorId: 7,
	createdAt: "2030-01-01T11:00:00Z",
	availableAt: "2030-01-01T12:05:00Z",
	hasError: true,
};
const records: DeliveryCardItem[] = [
	{
		...shared,
		id: "delivery-authorized-news-1234567890",
		errorId: "4f3df172-f1ca-4c26-a23e-cb4e6c13e9f2",
		operationId: "operation-authorized-news-1234567890",
		context: deliveryContext(
			"news.update",
			JSON.stringify({
				articleId: "9007199254740993",
				articleTitle: `Community update: ${"SummerFestival".repeat(14)}`,
				internalNotes: "SERIALIZED_METADATA_SECRET",
				lastError: "INTERNAL_FILE_PATH_SECRET",
			}),
			{ news: true, catalog: false },
		),
	},
	{
		...shared,
		id: "delivery-failed-catalog-1234567890",
		operationId: "operation-failed-catalog-1234567890",
		topic: "catalog.refresh",
		status: "failed",
		attempts: 5,
		context: deliveryContext("catalog.bulk.apply", '{"changedCount":9}', {
			news: false,
			catalog: true,
		}),
	},
	{
		...shared,
		id: "delivery-restricted-news",
		operationId: "operation-restricted-news",
		hasError: false,
		context: deliveryContext(
			"news.update",
			'{"articleTitle":"RESTRICTED_NEWS_TITLE","articleId":"99"}',
			{ news: false, catalog: true },
		),
	},
	{
		...shared,
		id: "delivery-restricted-catalog",
		operationId: "operation-restricted-catalog",
		topic: "catalog.refresh",
		hasError: false,
		context: deliveryContext("catalog.bulk.apply", '{"changedCount":489}', {
			news: true,
			catalog: false,
		}),
	},
	{
		...shared,
		id: "delivery-unknown",
		operationId: "operation-unknown",
		topic: "future.topic",
		status: "future.status",
		actorId: 0,
		createdAt: "invalid",
		context: deliveryContext(
			"future.operation",
			'{"articleTitle":"UNKNOWN_OPERATION_SECRET"}',
			{ news: true, catalog: true },
		),
	},
	{
		...shared,
		id: "delivery-completed-export",
		operationId: "operation-completed-export",
		topic: "catalog.export.request",
		status: "done",
		hasError: false,
		context: deliveryContext("catalog.bulk.apply", '{"changedCount":4}', {
			news: false,
			catalog: true,
		}),
	},
];

export function DeliveriesHarness() {
	const t = useTranslations("pages.admin.deliveries");
	return (
		<section aria-label="Delivery review" className="min-w-0 space-y-4">
			<p>{t("scope")}</p>
			<ul className="space-y-3">
				{records.map((item) => (
					<li key={item.id}>
						<DeliveryCard
							item={item}
							retry={
								item.status === "failed" ? (
									<Button type="button" variant="outline">
										{t("retry")}
									</Button>
								) : undefined
							}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}
