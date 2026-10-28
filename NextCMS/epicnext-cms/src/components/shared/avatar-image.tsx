"use client";

import {
	type AvatarOptions,
	avatarImageOnError,
	getAvatarUrl,
} from "@/lib/imager";

interface AvatarImageProps {
	figure: string;
	options?: AvatarOptions;
	width: number;
	height: number;
	alt: string;
	className?: string;
}

export function AvatarImage({
	figure,
	options,
	width,
	height,
	alt,
	className = "",
}: AvatarImageProps) {
	// Auto-pick the smallest size that still looks crisp at the requested
	// dimensions, unless the caller passed an explicit size.
	const max = Math.max(width, height);
	const autoSize: "s" | "m" | "l" =
		options?.size ??
		(options?.headOnly ? "l" : max <= 40 ? "s" : max <= 80 ? "m" : "l");

	return (
		<img
			src={getAvatarUrl(figure, { ...options, size: autoSize })}
			alt={alt}
			width={width}
			height={height}
			loading="lazy"
			decoding="async"
			onError={avatarImageOnError}
			style={{ maxWidth: width, maxHeight: height }}
			className={`image-pixelated object-contain ${className}`}
		/>
	);
}
