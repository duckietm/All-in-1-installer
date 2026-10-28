import { eq } from "drizzle-orm";
import { WebsiteSetting } from "@/db/schema";
import { db } from "./src/lib/db";

async function main() {
	const result = await db
		.select()
		.from(WebsiteSetting)
		.where(eq(WebsiteSetting.key, "habbo_imaging_url"));
	console.log("Current:", result);

	if (result[0]?.value !== "/imaging") {
		await db
			.update(WebsiteSetting)
			.set({ value: "/imaging" })
			.where(eq(WebsiteSetting.key, "habbo_imaging_url"));
		console.log("Updated to /imaging");
	} else {
		console.log("Already correct");
	}
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
