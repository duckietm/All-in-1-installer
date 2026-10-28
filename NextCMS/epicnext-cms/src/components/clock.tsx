"use client";

import { useEffect, useState } from "react";

const holidays: Record<string, { label: string; emoji: string }> = {
	"01-01": { label: "New Year", emoji: "🎉" },
	"02-14": { label: "Valentine's Day", emoji: "❤️" },
	"03-17": { label: "St. Patrick's Day", emoji: "🍀" },
	"04-01": { label: "April Fools", emoji: "🤡" },
	"05-05": { label: "Cinco de Mayo", emoji: "🌮" },
	"06-21": { label: "Summer Solstice", emoji: "☀️" },
	"07-04": { label: "Independence Day", emoji: "🎆" },
	"10-31": { label: "Halloween", emoji: "🎃" },
	"11-01": { label: "Day of the Dead", emoji: "💀" },
	"12-24": { label: "Christmas Eve", emoji: "🎄" },
	"12-25": { label: "Christmas Day", emoji: "🎄" },
	"12-26": { label: "Boxing Day", emoji: "🎁" },
	"12-31": { label: "New Year's Eve", emoji: "🎉" },
};

function getEaster(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const p = h + l - 7 * m + 114;
	return new Date(year, Math.floor(p / 32) - 1, (p % 31) + 1);
}

function getHoliday(now: Date): { label: string; emoji: string } | null {
	const key = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const staticHoliday = holidays[key];
	if (staticHoliday) return staticHoliday;

	const year = now.getFullYear();
	const easter = getEaster(year);
	const emd = `${String(easter.getMonth() + 1).padStart(2, "0")}-${String(easter.getDate()).padStart(2, "0")}`;

	const movable: Record<string, { label: string; emoji: string }> = {
		[emd]: { label: "Easter", emoji: "🐣" },
	};
	const ePlus1 = new Date(easter);
	ePlus1.setDate(ePlus1.getDate() + 1);
	const ep1k = `${String(ePlus1.getMonth() + 1).padStart(2, "0")}-${String(ePlus1.getDate()).padStart(2, "0")}`;
	movable[ep1k] = { label: "Easter Monday", emoji: "🐣" };

	return movable[key] ?? null;
}

export function Clock() {
	const [display, setDisplay] = useState("");

	useEffect(() => {
		function update() {
			const now = new Date();
			const holiday = getHoliday(now);
			const date = now.toLocaleDateString([], {
				day: "numeric",
				month: "short",
			});
			const time = now.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
			const parts = [date, time];
			if (holiday) parts.push(`${holiday.emoji} ${holiday.label}`);
			setDisplay(parts.join(" • "));
		}
		update();
		const id = setInterval(update, 30_000);
		return () => clearInterval(id);
	}, []);

	if (!display) return null;

	return (
		<span
			className="text-[11px] font-bold tabular-nums select-none whitespace-nowrap"
			style={{
				color: "color-mix(in srgb, var(--color-text-muted) 60%, transparent)",
			}}
		>
			{display}
		</span>
	);
}
