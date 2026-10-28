/**
 * Habbo-style currency icons used across admin (and reusable on public).
 * Files live at /assets/images/icons/currency/{name}.png
 */

export type CurrencyKind =
	| "credits"
	| "duckets"
	| "diamonds"
	| "pixels"
	| "points";

const CURRENCY_FILES: Record<CurrencyKind, string> = {
	credits: "credits",
	duckets: "duckets",
	diamonds: "diamonds",
	// No dedicated pixels asset — activity points share the duckets icon.
	pixels: "duckets",
	points: "duckets",
};

/** Map emulator `points_type` (catalog / users_currency) to an icon. */
export function currencyKindFromPointsType(type: number): CurrencyKind {
	if (type === 5) return "diamonds";
	return "duckets";
}

export function currencyIconSrc(kind: CurrencyKind): string {
	return `/assets/images/icons/currency/${CURRENCY_FILES[kind]}.png`;
}

export function CurrencyIcon({
	kind,
	size = 16,
	className = "",
	alt,
}: {
	kind: CurrencyKind;
	size?: number;
	className?: string;
	alt?: string;
}) {
	return (
		<img
			src={currencyIconSrc(kind)}
			alt={alt ?? kind}
			width={size}
			height={size}
			className={`inline-block shrink-0 object-contain image-pixelated ${className}`.trim()}
			style={{ width: size, height: size, imageRendering: "pixelated" }}
			draggable={false}
		/>
	);
}
