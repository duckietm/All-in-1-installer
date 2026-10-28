"use client";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
export function LocalEventTime({ value }: { value: string }) {
	const locale = useLocale();
	const [text, setText] = useState(
		`${value.slice(0, 16).replace("T", " ")} UTC`,
	);
	useEffect(() => {
		setText(
			new Intl.DateTimeFormat(locale, {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(new Date(value)),
		);
	}, [locale, value]);
	return <time dateTime={value}>{text}</time>;
}
