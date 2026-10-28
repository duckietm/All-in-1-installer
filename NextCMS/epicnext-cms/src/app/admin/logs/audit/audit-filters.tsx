"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const keys = ["actor", "action", "from", "to"] as const;
export function AuditFilters() {
	const t = useTranslations("pages.admin.logs.audit");
	const params = useSearchParams();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	function apply(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const values = new FormData(event.currentTarget);
		const next = new URLSearchParams(params.toString());
		for (const key of keys) {
			const value = String(values.get(key) ?? "").trim();
			if (value) next.set(key, value);
			else next.delete(key);
		}
		next.set("page", "1");
		startTransition(() => router.replace(`?${next}`, { scroll: false }));
	}
	function clear() {
		const next = new URLSearchParams(params.toString());
		for (const key of keys) next.delete(key);
		next.set("page", "1");
		startTransition(() => router.replace(`?${next}`, { scroll: false }));
	}
	return (
		<form onSubmit={apply} key={params.toString()} aria-busy={pending}>
			<fieldset disabled={pending} className="space-y-3 rounded-xl border p-4">
				<legend className="px-1 text-sm font-medium">
					{t("filtersTitle")}
				</legend>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{keys.map((key) => (
						<label
							htmlFor={`audit-${key}`}
							key={key}
							className="space-y-1 text-sm"
						>
							<span>{t(`filter${key[0].toUpperCase()}${key.slice(1)}`)}</span>
							<Input
								id={`audit-${key}`}
								name={key}
								type={key === "from" || key === "to" ? "date" : "text"}
								maxLength={191}
								defaultValue={params.get(key) ?? ""}
							/>
						</label>
					))}
				</div>
				<p className="text-xs text-muted-foreground">{t("filtersHint")}</p>
				<div className="flex flex-wrap gap-2">
					<Button type="submit" size="sm">
						{t("applyFilters")}
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={clear}>
						{t("resetFilters")}
					</Button>
				</div>
			</fieldset>
		</form>
	);
}
