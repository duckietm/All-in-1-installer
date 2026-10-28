import { eq } from "drizzle-orm";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateMotto } from "@/actions/user-settings";
import Link from "@/components/link";
import { Reveal } from "@/components/motion-reveal";
import { SurfaceCard } from "@/components/surface-card";
import { auth } from "@/lib/auth";
import { db, User } from "@/lib/db";
import { avatarImageUrl } from "@/lib/format";
import {
	ICON_NAV_COMMUNITY,
	ICON_NAV_GOODY,
	ICON_NAV_ME,
	ICON_STAR,
} from "@/lib/site-icons";
import ProfilePrivacySettings from "./ProfilePrivacySettings";
export default async function SettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ privacy?: string }>;
}) {
	const { privacy } = await searchParams;
	const t = await getTranslations("pages.settings");
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const id = Number(session.user.id);

	let user: {
		username: string;
		motto: string;
		look: string;
		mail: string | null;
	} | null = null;
	try {
		const [row] = await db
			.select({
				username: User.username,
				motto: User.motto,
				look: User.look,
				mail: User.mail,
			})
			.from(User)
			.where(eq(User.id, id))
			.limit(1);
		user = row ?? null;
	} catch {
		user = null;
	}

	if (!user) redirect("/login");

	const avatar = avatarImageUrl(user.look);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-14">
			<ProfilePrivacySettings userId={id} status={privacy} />
			{/* Header */}
			<Reveal>
				<SurfaceCard
					className="relative px-5 py-4"
					style={{
						background:
							"color-mix(in srgb, var(--color-surface) 60%, transparent)",
						backdropFilter: "blur(14px)",
						WebkitBackdropFilter: "blur(14px)",
						borderColor:
							"color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
					}}
				>
					<div className="flex items-center gap-3">
						<div
							className="flex h-10 w-10 items-center justify-center rounded-xl"
							style={{
								background:
									"color-mix(in srgb, var(--color-primary) 14%, transparent)",
							}}
						>
							<Image
								src={ICON_NAV_ME}
								alt=""
								width={22}
								height={22}
								unoptimized
							/>
						</div>
						<div>
							<h1
								className="text-lg font-black tracking-tight"
								style={{
									color: "var(--color-text-readable)",
									fontFamily: "var(--font-nunito)",
								}}
							>
								{t("accountSettings")}
							</h1>
							<p
								className="text-xs"
								style={{ color: "var(--color-text-muted)" }}
							>
								{t("accountSettingsSubtitle")}
							</p>
						</div>
					</div>
				</SurfaceCard>
			</Reveal>

			{/* Profile card */}
			<Reveal delay={0.05}>
				<SurfaceCard
					title={t("publicProfile")}
					icon={ICON_NAV_ME}
					bodyClassName="p-5 flex flex-col sm:flex-row items-center sm:items-center gap-5"
				>
					<div className="shrink-0">
						<div
							className="overflow-hidden rounded-xl border"
							style={{
								borderColor:
									"color-mix(in srgb, var(--color-primary) 15%, transparent)",
							}}
						>
							<Image
								src={avatar}
								alt={`${user.username} avatar`}
								width={80}
								height={120}
								className="block"
								unoptimized
							/>
						</div>
					</div>
					<div className="min-w-0 flex-1">
						<h3
							className="text-base font-extrabold"
							style={{ color: "var(--color-text-readable)" }}
						>
							{user.username}
						</h3>
						<p
							className="text-sm mt-0.5"
							style={{ color: "var(--color-text-muted)" }}
						>
							{user.motto || (
								<span style={{ fontStyle: "italic", opacity: 0.5 }}>
									{t("noMotto")}
								</span>
							)}
						</p>
						<p
							className="text-xs mt-1.5 font-medium"
							style={{
								color:
									"color-mix(in srgb, var(--color-text-muted) 70%, transparent)",
							}}
						>
							{user.mail || t("noEmail")}
						</p>
					</div>
				</SurfaceCard>
			</Reveal>

			{/* Motto form */}
			<Reveal delay={0.1}>
				<SurfaceCard
					title={t("changeMotto")}
					icon={ICON_STAR}
					bodyClassName="p-5"
				>
					<p
						className="text-xs mb-4"
						style={{ color: "var(--color-text-muted)" }}
					>
						{t("changeMottoSubtitle")}
					</p>
					<form
						action={updateMotto}
						className="flex flex-col gap-3"
						style={{ maxWidth: 520 }}
					>
						<input
							name="motto"
							defaultValue={user.motto}
							maxLength={127}
							placeholder={t("mottoPlaceholder")}
							aria-label="Motto"
							className="input-glow w-full rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all focus:outline-none"
							style={{
								backgroundColor: "var(--color-background)",
								color: "var(--color-text-readable)",
								borderColor:
									"color-mix(in srgb, var(--color-text-muted) 25%, transparent)",
							}}
						/>
						<div>
							<button
								type="submit"
								className="btn-shine inline-flex items-center gap-2 font-extrabold text-sm px-5 py-2.5 rounded-xl transition-all duration-200 hover:scale-[1.03] active:scale-95 shadow-lg"
								style={{
									background: "var(--color-primary)",
									color: "var(--color-primary-foreground)",
									boxShadow:
										"0 4px 20px color-mix(in srgb, var(--color-primary) 30%, transparent)",
								}}
							>
								{t("saveMotto")}
							</button>
						</div>
					</form>
				</SurfaceCard>
			</Reveal>

			{/* Security card */}
			<Reveal delay={0.15}>
				<SurfaceCard
					title={t("securityTitle")}
					icon={ICON_NAV_GOODY}
					bodyClassName="p-5"
				>
					<p
						className="text-xs mb-4"
						style={{ color: "var(--color-text-muted)" }}
					>
						{t("securityDescription")}
					</p>
					<Link
						href="/settings/2fa"
						className="inline-flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded-xl border-2 transition-all duration-200 hover:scale-[1.03] active:scale-95 backdrop-blur-sm"
						style={{
							borderColor:
								"color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
							color: "var(--color-text-readable)",
							background:
								"color-mix(in srgb, var(--color-surface) 50%, transparent)",
						}}
					>
						{t("twoFactorLink")}
					</Link>
				</SurfaceCard>
			</Reveal>

			{/* Sessions link */}
			<Reveal delay={0.2}>
				<Link href="/settings/sessions" className="block">
					<SurfaceCard className="transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
						<div
							className="flex items-center justify-between px-5 py-4"
							style={{ backgroundColor: "var(--color-surface)" }}
						>
							<div className="flex items-center gap-3">
								<div
									className="flex h-10 w-10 items-center justify-center rounded-xl"
									style={{
										background:
											"color-mix(in srgb, var(--color-primary) 14%, transparent)",
									}}
								>
									<Image
										src={ICON_NAV_COMMUNITY}
										alt=""
										width={20}
										height={20}
										unoptimized
									/>
								</div>
								<div>
									<span
										className="text-sm font-extrabold"
										style={{ color: "var(--color-text-readable)" }}
									>
										Session Management
									</span>
									<p
										className="text-xs mt-0.5"
										style={{ color: "var(--color-text-muted)" }}
									>
										View active sessions and sign out everywhere
									</p>
								</div>
							</div>
							<span
								className="text-lg font-bold"
								style={{ color: "var(--color-text-muted)" }}
							>
								→
							</span>
						</div>
					</SurfaceCard>
				</Link>
			</Reveal>
		</div>
	);
}
