"use client";

import { cn } from "@/lib/utils";

interface DateTimePickerProps {
	value?: Date | string | null;
	onChange: (date: Date | null) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	showTime?: boolean;
}

function inputValue(
	value: Date | string | null | undefined,
	showTime: boolean,
): string {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, showTime ? 16 : 10);
}

export function DateTimePicker({
	value,
	onChange,
	placeholder,
	disabled = false,
	className,
	showTime = true,
}: DateTimePickerProps) {
	return (
		<input
			aria-label={placeholder ?? (showTime ? "Date and time" : "Date")}
			className={cn("w-full", className)}
			disabled={disabled}
			type={showTime ? "datetime-local" : "date"}
			value={inputValue(value, showTime)}
			onChange={(event) =>
				onChange(event.target.value ? new Date(event.target.value) : null)
			}
		/>
	);
}
