import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { operationHash } from "@/features/operations/model";
import { enqueueEffect } from "@/features/operations/server";
import { db, rowsFrom } from "@/lib/db";
import { logger } from "@/lib/logger";
import { invalidateNewsCache } from "./news-cache";

/** MySQL rolls the entire victim transaction back on this specific error. */
function isDeadlock(error: unknown): boolean {
	let cause = error;
	for (
		let depth = 0;
		cause && typeof cause === "object" && depth < 5;
		depth++
	) {
		const record = cause as {
			code?: unknown;
			errno?: unknown;
			cause?: unknown;
		};
		if (record.code === "ER_LOCK_DEADLOCK" || record.errno === 1213)
			return true;
		cause = record.cause;
	}
	return false;
}

/** Publish a bounded batch and persist its refresh work before committing. */
export async function publishDueArticles(now = new Date()): Promise<number> {
	// Match Drizzle's TIMESTAMP writes; raw Date parameters use the host timezone.
	const utcNow = now.toISOString().slice(0, -1).replace("T", " ");
	let published: number;
	for (let attempt = 0; ; attempt++) {
		try {
			published = await db.transaction(async (tx) => {
				let published = 0;
				for (const article of rowsFrom<{
					id: string;
					userId: number | null;
					title: string | null;
					publishAt: Date | string;
				}>(
					await tx.execute(
						sql`SELECT CAST(id AS CHAR) AS id,user_id AS userId,title,publish_at AS publishAt FROM website_articles WHERE status='scheduled' AND publish_at<=${utcNow} ORDER BY publish_at,id LIMIT 100 FOR UPDATE`,
					),
				)) {
					const [result] = await tx.execute(
						sql`UPDATE website_articles SET status='published',published_at=${utcNow},updated_at=${utcNow} WHERE id=${article.id} AND status='scheduled' AND publish_at<=${utcNow}`,
					);
					if (result.affectedRows !== 1) continue;
					const operationId = randomUUID();
					const hash = operationHash({
						articleId: article.id,
						publishAt: new Date(article.publishAt).toISOString(),
					});
					// Legacy articles without an author remain attributed to system (0).
					await tx.execute(
						sql`INSERT INTO cms_operations (id,actor_id,kind,request_key,request_hash,result_json) VALUES (${operationId},${article.userId ?? 0},${"news.schedule.publish"},${randomUUID()},${hash},${JSON.stringify({ articleId: article.id, articleTitle: article.title, published: true })})`,
					);
					await enqueueEffect(tx, operationId, "news.refresh");
					published++;
				}
				return published;
			});
			break;
		} catch (error) {
			// Retry only known rollbacks, never timeouts or an unknown commit outcome.
			if (attempt >= 2 || !isDeadlock(error)) throw error;
		}
	}
	if (published > 0) {
		try {
			await invalidateNewsCache();
		} catch (error) {
			logger.error("Scheduled news published; cache refresh remains queued", {
				module: "news",
				error,
			});
		}
	}
	return published;
}
