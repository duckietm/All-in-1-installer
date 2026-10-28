import { AvatarImage } from "@/components/shared/avatar-image";
import type { AvatarOptions } from "@/lib/imager";

export interface UserAvatarThumbnailProps {
	figure: string;
	alt: string;
	options?: Omit<AvatarOptions, "headOnly" | "size">;
	className?: string;
}

export function UserAvatarThumbnail({
	figure,
	alt,
	options,
	className = "",
}: UserAvatarThumbnailProps) {
	return (
		<AvatarImage
			figure={figure}
			options={{ ...options, headOnly: true, size: "l" }}
			width={40}
			height={40}
			alt={alt}
			className={`shrink-0 ${className}`.trim()}
		/>
	);
}
