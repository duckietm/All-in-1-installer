import { eq } from "drizzle-orm";
import { HelpCircle } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { deleteHelpQuestion, updateHelpQuestion } from "@/actions/admin-help";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, WebsiteHelpCenterCategories } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function EditHelpQuestion({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const { id } = await params;
	const { error } = await searchParams;
	let entry: typeof WebsiteHelpCenterCategories.$inferSelect | null = null;
	try {
		const [row] = await db
			.select()
			.from(WebsiteHelpCenterCategories)
			.where(eq(WebsiteHelpCenterCategories.id, BigInt(id)))
			.limit(1);
		entry = row ?? null;
	} catch {
		notFound();
	}
	if (!entry) notFound();

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<HelpCircle size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div className="flex-1">
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						Edit help-center entry
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
				action={updateHelpQuestion}
				className="admin-card"
				style={{ display: "grid", gap: "0.6rem" }}
			>
				<input type="hidden" name="id" value={String(entry.id)} />
				<input
					name="name"
					defaultValue={entry.name}
					placeholder="Name / title"
					required
					maxLength={255}
				/>
				<textarea
					name="content"
					defaultValue={entry.content}
					placeholder="Content"
					rows={6}
					required
				/>
				<input
					name="position"
					type="number"
					min={1}
					defaultValue={entry.position}
					placeholder="Position"
				/>
				<input
					name="imageUrl"
					defaultValue={entry.imageUrl ?? ""}
					placeholder="Image URL (optional)"
					maxLength={255}
				/>
				<input
					name="buttonText"
					defaultValue={entry.buttonText ?? ""}
					placeholder="Button text (optional)"
					maxLength={255}
				/>
				<input
					name="buttonUrl"
					defaultValue={entry.buttonUrl ?? ""}
					placeholder="Button URL (optional)"
					maxLength={255}
				/>
				<label className="flex gap-1.5 items-center">
					Button color
					<input
						name="buttonColor"
						type="color"
						defaultValue={entry.buttonColor}
					/>
				</label>
				<label className="flex gap-1.5 items-center">
					Button border color
					<input
						name="buttonBorderColor"
						type="color"
						defaultValue={entry.buttonBorderColor}
					/>
				</label>
				<label className="flex gap-1.5 items-center">
					<input
						name="smallBox"
						type="checkbox"
						value="1"
						defaultChecked={entry.smallBox}
					/>
					Small box
				</label>
				<Button type="submit" variant="default">
					Save
				</Button>
			</form>
			<form action={deleteHelpQuestion} style={{ marginTop: "1rem" }}>
				<input type="hidden" name="id" value={String(entry.id)} />
				<Button type="submit" variant="destructive">
					Delete entry
				</Button>
			</form>
		</main>
	);
}
