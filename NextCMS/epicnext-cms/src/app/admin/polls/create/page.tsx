import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { PollForm } from "../poll-form";

export default async function CreatePollPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.POLLS_EDIT, session.user.rank)) {
		redirect("/admin/polls");
	}

	const t = await getTranslations("pages.admin.polls");

	return (
		<div className="space-y-6">
			<div>
				<h1 className="m-0 text-2xl font-extrabold text-[var(--admin-text)]">
					{t("createTitle")}
				</h1>
				<p className="m-0 mt-1 text-sm text-[var(--admin-text-muted)]">
					{t("createSubtitle")}
				</p>
			</div>

			<PollForm />
		</div>
	);
}
