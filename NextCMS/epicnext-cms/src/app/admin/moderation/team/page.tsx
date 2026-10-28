import { and, count, desc, gte, inArray, like } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "@/components/link";
import { AvatarImage } from "@/components/shared/avatar-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import {
	AdminAuditLog,
	db,
	SupportTickets,
	User,
	WebsiteTicket,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function ModTeamPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.MODERATION_VIEW, session.user.rank))
		redirect("/admin");

	const minStaffRank = await getMinStaffRank();
	const staff = await db
		.select({
			id: User.id,
			username: User.username,
			look: User.look,
			rank: User.rank,
			online: User.online,
			lastLogin: User.lastLogin,
			lastOnline: User.lastOnline,
		})
		.from(User)
		.where(gte(User.rank, minStaffRank))
		.orderBy(desc(User.online), desc(User.rank));

	const staffIds = staff.map((s) => s.id);

	// Get CFH ticket counts per mod and web ticket counts
	const [cfhCounts, webTicketCounts, modActionCounts] = await Promise.all([
		staffIds.length
			? db
					.select({
						modId: SupportTickets.modId,
						total: count(),
					})
					.from(SupportTickets)
					.where(inArray(SupportTickets.modId, staffIds))
					.groupBy(SupportTickets.modId)
			: Promise.resolve([]),
		staffIds.length
			? db
					.select({
						assigneeId: WebsiteTicket.assigneeId,
						total: count(),
					})
					.from(WebsiteTicket)
					.where(inArray(WebsiteTicket.assigneeId, staffIds))
					.groupBy(WebsiteTicket.assigneeId)
			: Promise.resolve([]),
		staffIds.length
			? db
					.select({
						userId: AdminAuditLog.userId,
						total: count(),
					})
					.from(AdminAuditLog)
					.where(
						and(
							inArray(AdminAuditLog.userId, staffIds),
							like(AdminAuditLog.action, "mod_%"),
						),
					)
					.groupBy(AdminAuditLog.userId)
			: Promise.resolve([]),
	]);

	const cfhMap = new Map(cfhCounts.map((c) => [c.modId, Number(c.total)]));
	const webMap = new Map(
		webTicketCounts.map((c) => [c.assigneeId, Number(c.total)]),
	);
	const actionMap = new Map(
		modActionCounts.map((c) => [c.userId, Number(c.total)]),
	);

	return (
		<div className="space-y-6">
			{/* Summary */}
			<div className="grid gap-4 grid-cols-3">
				<Card>
					<CardContent className="pt-4 text-center">
						<p className="text-2xl font-bold text-[var(--admin-success)]">
							{staff.filter((s) => s.online === "1").length}
						</p>
						<p className="text-xs text-muted-foreground">Online Now</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-4 text-center">
						<p className="text-2xl font-bold">{staff.length}</p>
						<p className="text-xs text-muted-foreground">Total Staff</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-4 text-center">
						<p className="text-2xl font-bold text-primary">
							{staff.filter((s) => s.rank > minStaffRank).length}
						</p>
						<p className="text-xs text-muted-foreground">Above min rank</p>
					</CardContent>
				</Card>
			</div>

			{/* Staff list */}
			<div className="rounded-lg border">
				<div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-4 p-3 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
					<span></span>
					<span>Name</span>
					<span>Rank</span>
					<span>CFH</span>
					<span>Tickets</span>
					<span>Actions</span>
					<span>Last Seen</span>
				</div>

				{staff.map((member) => (
					<Link
						key={member.id}
						href={`/admin/users/show/${member.id}`}
						className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-4 p-3 items-center hover:bg-accent/50 transition-all duration-150 border-b last:border-0"
					>
						<div className="relative">
							<AvatarImage
								figure={member.look}
								options={{ headOnly: true }}
								alt={member.username}
								width={32}
								height={32}
							/>
							<span
								className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
									member.online === "1"
										? "bg-[var(--admin-success)]"
										: "bg-[var(--admin-text-muted)]"
								}`}
							/>
						</div>
						<div>
							<p className="text-sm font-medium">{member.username}</p>
						</div>
						<Badge variant="outline" className="text-[10px]">
							Rank {member.rank}
						</Badge>
						<div className="text-center">
							<p className="text-sm font-bold">{cfhMap.get(member.id) ?? 0}</p>
							<p className="text-[9px] text-muted-foreground">CFH</p>
						</div>
						<div className="text-center">
							<p className="text-sm font-bold">{webMap.get(member.id) ?? 0}</p>
							<p className="text-[9px] text-muted-foreground">Web</p>
						</div>
						<div className="text-center">
							<p className="text-sm font-bold">
								{actionMap.get(member.id) ?? 0}
							</p>
							<p className="text-[9px] text-muted-foreground">Mod</p>
						</div>
						<span className="text-xs text-muted-foreground whitespace-nowrap">
							{member.online === "1"
								? "Online"
								: member.lastOnline
									? formatDate(new Date(member.lastOnline * 1000), "date")
									: "—"}
						</span>
					</Link>
				))}
			</div>
		</div>
	);
}
