import "./load-env";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
	const [dp] = (await db.execute(sql`
		SELECT CAST(parent_id AS CHAR) parentId, CAST(order_num AS CHAR) orderNum, COUNT(*) c, GROUP_CONCAT(id) ids
		FROM catalog_pages
		GROUP BY parent_id, order_num
		HAVING COUNT(*) > 1
	`)) as unknown as [Array<Record<string, unknown>>, unknown];
	console.log("=== catalog_pages duplicate (parent, order_num) groups ===");
	console.log(JSON.stringify(dp));

	const [children] = (await db.execute(sql`
		SELECT CAST(parent_id AS CHAR) parentId, COUNT(*) c
		FROM catalog_pages
		WHERE parent_id <> 0
		GROUP BY parent_id ORDER BY c DESC LIMIT 8
	`)) as unknown as [Array<Record<string, unknown>>, unknown];
	console.log("=== most children per parent ===");
	console.log(JSON.stringify(children));

	const [pages] = (await db.execute(sql`
		SELECT CAST(id AS CHAR) id, CAST(parent_id AS CHAR) parentId, CAST(order_num AS CHAR) orderNum, caption_save caption, enabled
		FROM catalog_pages WHERE id IN (353,354,355,356,357,358)
	`)) as unknown as [Array<Record<string, unknown>>, unknown];
	console.log("=== pages 353-358 ===");
	console.log(JSON.stringify(pages, null, 1));
	await db.$client?.end?.();
}
void main();
