"use client";
import { useTranslations } from "next-intl";

interface Badge {
	id: number;
	badgeCode: string;
}

export function UserBadgesReadonly({ badges }: { badges: Badge[] }) {
	const t = useTranslations("pages.admin.users.presentation");
	if (badges.length === 0) {
		return <p className="text-sm text-muted-foreground">{t("noBadges")}</p>;
	}

	return (
		<div className="flex flex-wrap gap-2">
			{badges.map((badge) => (
				<div
					key={badge.id}
					className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm"
				>
					<img
						src={`/api/imaging/badge?source=local&code=${encodeURIComponent(badge.badgeCode)}`}
						alt={badge.badgeCode}
						className="h-5 w-5"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = "none";
						}}
					/>
					<span>{badge.badgeCode}</span>
				</div>
			))}
		</div>
	);
}
