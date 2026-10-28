"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { WebsiteProfilePrivacy } from "@/db/profile-privacy";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
export async function saveProfilePrivacy(formData: FormData): Promise<void> {
	const session = await auth();
	const userId = Number(session?.user?.id);
	if (!Number.isSafeInteger(userId) || userId <= 0) redirect("/login");
	let outcome = "error";
	try {
		if ((await rateLimit(`profile-privacy:${userId}`, 10, 60_000)).ok) {
			const values = {
				wallet: formData.get("wallet") === "on",
				online: formData.get("online") === "on",
				friends: formData.get("friends") === "on",
				photos: formData.get("photos") === "on",
				registered: formData.get("registered") === "on",
			};
			await db
				.insert(WebsiteProfilePrivacy)
				.values({ userId, ...values })
				.onDuplicateKeyUpdate({ set: values });
			revalidatePath("/u/[username]", "page");
			revalidatePath("/settings");
			outcome = "saved";
		}
	} catch {
		outcome = "error";
	}
	redirect(`/settings?privacy=${outcome}#profile-privacy`);
}
