"use client";

import Image from "next/image";
import { avatarImageUrl } from "@/lib/format";

export interface OnlineUser {
	id: number;
	username: string;
	look: string;
	roomId: number | null;
	roomName: string | null;
	lastActivity: Date;
}

/** Live list of online users with room and activity tracking */
export function OnlineUsersWidget({
	users,
	isLoading = false,
}: {
	users: OnlineUser[];
	isLoading?: boolean;
}) {
	const formatLastSeen = (date: Date) => {
		const now = new Date();
		const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

		if (diff < 60) return "Just now";
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	};

	return (
		<div className="bg-[var(--admin-surface)] rounded-xl border border-[var(--admin-border)] p-6">
			<div className="flex justify-between items-center mb-4">
				<h3 className="m-0 text-lg font-semibold text-[var(--admin-text)]">
					Online Now
				</h3>
				<span className="text-sm text-[var(--admin-text-muted)] bg-[var(--admin-accent)]/10 px-3 py-1 rounded-full">
					{isLoading ? "..." : users.length} users
				</span>
			</div>

			<div className="max-h-80 overflow-y-auto flex flex-col gap-3">
				{users.length === 0 ? (
					<div className="py-8 text-center bg-[var(--admin-text-muted)]/5 rounded-lg">
						<span className="text-[var(--admin-text-muted)] text-sm">
							No users online
						</span>
					</div>
				) : (
					users.map((user) => (
						<div
							key={user.id}
							className="flex items-center gap-3 p-3 bg-[var(--admin-text-muted)]/5 rounded-lg transition-all duration-150 hover:bg-[var(--admin-text-muted)]/10 hover:translate-x-0.5"
						>
							<div className="relative flex-none w-[50px] h-[62px]">
								<Image
									src={avatarImageUrl(user.look, { size: "s", headOnly: true })}
									alt={user.username}
									fill
									className="rounded object-cover border border-[var(--admin-border)]"
									unoptimized
								/>
								{user.roomId && user.roomName && (
									<div className="absolute -bottom-0.5 -right-0.5">
										<span className="block w-[10px] h-[10px] bg-[var(--admin-success-subtle)] rounded-full border-2 border-[var(--admin-surface)]" />
									</div>
								)}
							</div>

							<div className="flex-1 min-w-0">
								<div className="font-medium text-[var(--admin-text)] mb-1 truncate">
									<a
										href={`/u/${user.username}`}
										className="text-inherit no-underline hover:text-[var(--admin-accent)] hover:underline"
									>
										{user.username}
									</a>
								</div>
								<div className="text-[0.75rem] text-[var(--admin-text-muted)]">
									{user.roomId && user.roomName ? (
										<span className="text-[var(--admin-success)] font-medium">
											🏠 {user.roomName}
										</span>
									) : (
										<span className="text-[var(--admin-error)]">
											⏱️ {formatLastSeen(user.lastActivity)}
										</span>
									)}
								</div>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
