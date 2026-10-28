"use client";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type SearchInputProps = {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	onClear?: () => void;
};

/** Admin search field with a leading search icon and optional clear button. */
export function SearchInput({
	value,
	onChange,
	placeholder,
	onClear,
}: SearchInputProps) {
	const t = useTranslations("pages.admin.table");
	return (
		<div className="relative">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			<Input
				aria-label={placeholder ?? t("search")}
				placeholder={placeholder ?? t("search")}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				style={{ paddingLeft: 36, paddingRight: 40 }}
				className="pl-9 pr-10 h-9"
			/>
			{value && onClear && (
				<button
					type="button"
					onClick={onClear}
					className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					aria-label={t("clearSearch")}
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
