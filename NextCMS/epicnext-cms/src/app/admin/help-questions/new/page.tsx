import { HelpCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { createHelpQuestion } from "@/actions/admin-help";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function NewHelpQuestion({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	const { error } = await searchParams;

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<HelpCircle size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div className="flex-1">
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						New help-center entry
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						<Link href="/admin/help-questions">← Help Center</Link>
					</p>
				</div>
			</div>
			{error ? (
				<p
					className="text-xs theme-text-muted dark:theme-text-muted mb-4"
					style={{ color: "#dc2626" }}
				>
					Error: {error}
				</p>
			) : null}
			<form
				action={createHelpQuestion}
				className="admin-card"
				style={{ display: "grid", gap: "0.6rem" }}
			>
				<input
					name="name"
					placeholder="Name / title"
					required
					maxLength={255}
				/>
				<textarea name="content" placeholder="Content" rows={6} required />
				<input
					name="position"
					type="number"
					min={1}
					defaultValue={1}
					placeholder="Position"
				/>
				<input
					name="imageUrl"
					placeholder="Image URL (optional)"
					maxLength={255}
				/>
				<input
					name="buttonText"
					placeholder="Button text (optional)"
					maxLength={255}
				/>
				<input
					name="buttonUrl"
					placeholder="Button URL (optional)"
					maxLength={255}
				/>
				<label className="flex gap-1.5 items-center">
					Button color
					<input name="buttonColor" type="color" defaultValue="#eeb425" />
				</label>
				<label className="flex gap-1.5 items-center">
					Button border color
					<input name="buttonBorderColor" type="color" defaultValue="#facc15" />
				</label>
				<label className="flex gap-1.5 items-center">
					<input name="smallBox" type="checkbox" value="1" />
					Small box
				</label>
				<Button type="submit" variant="default">
					Create
				</Button>
			</form>
		</main>
	);
}
