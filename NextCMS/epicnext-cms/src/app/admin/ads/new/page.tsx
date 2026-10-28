import { Megaphone } from "lucide-react";
import { redirect } from "next/navigation";
import { createAd } from "@/actions/admin-ads";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function NewAd() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Megaphone size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						New advertisement
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						<Link href="/admin/ads">← Advertisements</Link>
					</p>
				</div>
			</div>
			<form action={createAd} className="admin-card">
				<input name="image" placeholder="Image URL" required maxLength={255} />
				<Button type="submit" variant="default">
					Create
				</Button>
			</form>
		</main>
	);
}
