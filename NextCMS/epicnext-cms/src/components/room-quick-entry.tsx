"use client";

import { useTranslations } from "next-intl";

export function RoomQuickEntry() {
	const t = useTranslations("header");
	return (
		<form
			action="/client"
			method="GET"
			className="hidden sm:flex items-center gap-1"
			onSubmit={(e) => {
				const form = e.currentTarget;
				const input = form.elements.namedItem(
					"roomId",
				) as HTMLInputElement | null;
				if (input?.value) {
					form.action = `/room/${input.value}`;
				}
			}}
		>
			<input
				type="number"
				name="roomId"
				placeholder={t("roomId")}
				aria-label={t("roomId")}
				min={1}
				className="w-20 rounded-lg border px-2 py-1 text-xs font-medium"
				style={{
					background: "var(--color-background)",
					color: "var(--color-text-readable)",
					borderColor:
						"color-mix(in srgb, var(--color-text-muted) 25%, transparent)",
				}}
			/>
			<button
				type="submit"
				className="rounded-lg px-2 py-1 text-xs font-bold transition-colors"
				style={{
					background:
						"color-mix(in srgb, var(--color-primary) 20%, transparent)",
					color: "var(--color-primary-readable, var(--color-primary))",
				}}
			>
				{t("go")}
			</button>
		</form>
	);
}
