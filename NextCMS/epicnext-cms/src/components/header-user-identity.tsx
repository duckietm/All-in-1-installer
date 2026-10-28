import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";

interface HeaderUserIdentityProps {
	figure: string;
	username: string;
	textColor: string;
}

export function HeaderUserIdentity({
	figure,
	username,
	textColor,
}: HeaderUserIdentityProps) {
	return (
		<span className="flex items-center gap-2">
			<UserAvatarThumbnail figure={figure} alt="" options={{ direction: 2 }} />
			<span
				className="hidden sm:inline font-semibold"
				style={{ color: textColor }}
			>
				{username}
			</span>
		</span>
	);
}
