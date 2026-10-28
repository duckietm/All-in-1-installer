import type { ReactNode } from "react";
import { AuthTopBar } from "@/components/auth/auth-top-bar";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { SurfaceCard } from "@/components/surface-card";
import { loadProfilePrivacyMap } from "@/lib/services/profile-privacy";
import { ICON_FRIENDS, ICON_NAV_GOODY, ICON_NAV_ME } from "@/lib/site-icons";

export interface PublicUser {
	id: number;
	username: string;
	look: string;
}

/**
 * The decorative aurora blobs that sit behind the auth top bar on `/login` and
 * `/register`. Purely visual, hence aria-hidden, and shared so both pages keep
 * the exact same tint and delay.
 */
export function AuthAurora() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute -inset-x-16 -top-24 overflow-hidden"
		>
			<div
				className="aurora-blob -left-20 top-0 h-80 w-80"
				style={{
					background:
						"color-mix(in srgb, var(--color-primary) 34%, transparent)",
					opacity: 0.45,
				}}
			/>
			<div
				className="aurora-blob -right-20 top-6 h-72 w-72"
				style={{
					background:
						"color-mix(in srgb, var(--color-accent) 30%, transparent)",
					animationDelay: "-7s",
					opacity: 0.4,
				}}
			/>
		</div>
	);
}

interface AuthUsersCardsProps {
	recentUsers: PublicUser[];
	latestUsers: PublicUser[];
	/** Title of the online-users card. */
	recentTitle: string;
	/** Title of the newest-accounts card. */
	latestTitle: string;
}

/**
 * The "who is online" + "newest citizens" avatar cards both auth pages show in
 * their left column. Cards with no users render nothing, so a cold database
 * degrades to just the intro panel instead of an empty grid.
 */
export async function AuthUsersCards({
	recentUsers,
	latestUsers,
	recentTitle,
	latestTitle,
}: AuthUsersCardsProps) {
	// "Hide my online status" must hold outside the profile too — the roster is
	// exactly where that setting is worth the most.
	const privacy = await loadProfilePrivacyMap(recentUsers.map((u) => u.id));
	const onlineUsers = recentUsers.filter(
		(u) => privacy.get(u.id)?.online !== false,
	);
	return (
		<>
			{onlineUsers.length > 0 && (
				<SurfaceCard
					title={recentTitle}
					icon={ICON_NAV_GOODY}
					bodyClassName="p-4"
					className="card-glow"
				>
					<AvatarGrid users={onlineUsers} online />
				</SurfaceCard>
			)}
			{latestUsers.length > 0 && (
				<SurfaceCard
					title={latestTitle}
					icon={ICON_FRIENDS}
					bodyClassName="p-4"
					className="card-glow"
				>
					<AvatarGrid users={latestUsers} />
				</SurfaceCard>
			)}
		</>
	);
}

function AvatarGrid({
	users,
	online,
}: {
	users: PublicUser[];
	online?: boolean;
}) {
	return (
		<div className="grid grid-cols-4 gap-1.5 sm:gap-2">
			{users.map((u) => (
				<div key={u.username} title={u.username} className="avatar-tile">
					<div className="relative">
						<UserAvatarThumbnail
							figure={u.look}
							alt=""
							options={{ direction: 2 }}
							className="rounded-lg"
						/>
						{online && (
							<span className="avatar-online absolute -bottom-0.5 -right-0.5" />
						)}
					</div>
					<span className="avatar-name">{u.username}</span>
				</div>
			))}
		</div>
	);
}

interface AuthPageFrameProps {
	hotelName: string;
	logo?: string | null;
	/** Live online count shown in the top bar; omit to hide it. */
	online?: number;
	/** Title of the form card on the right. */
	title: string;
	/** One-line intro above the form. */
	subtitle: ReactNode;
	/** Optional notice rendered at the top of the form card (e.g. "registered"). */
	notice?: ReactNode;
	/** The form itself. */
	form: ReactNode;
	/** The left column: intro panel plus `AuthUsersCards`. */
	children: ReactNode;
}

/**
 * Shared skeleton for the public auth pages: aurora + top bar on top, a fixed
 * left column for the promo/roster panels and a sticky right column holding the
 * form. Both `/login` and `/register` used to duplicate all of it.
 */
export function AuthPageFrame({
	hotelName,
	logo,
	online,
	title,
	subtitle,
	notice,
	form,
	children,
}: AuthPageFrameProps) {
	return (
		<div className="mx-auto w-full max-w-6xl flex flex-col gap-8 pb-16">
			<div className="relative">
				<AuthAurora />
				<AuthTopBar hotelName={hotelName} logo={logo} online={online} />
			</div>

			{/* Not in <Reveal>: the login form is above the fold and must show before the JavaScript runs. */}
			<div>
				<div className="flex flex-col gap-8 lg:flex-row lg:items-start">
					<div className="lg:w-96 shrink-0 space-y-4">{children}</div>

					<div className="flex-1 lg:sticky lg:top-6">
						<div className="gradient-border">
							<SurfaceCard
								title={title}
								icon={ICON_NAV_ME}
								bodyClassName="p-6 sm:p-7"
								className="card-glow"
							>
								{notice}
								<p
									className="text-sm mb-6 leading-relaxed"
									style={{ color: "var(--color-text-muted)" }}
								>
									{subtitle}
								</p>
								{form}
							</SurfaceCard>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
