"use client";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
export function ArticleListSubmit() {
	const { pending } = useFormStatus();
	const t = useTranslations("pages.admin.articles");
	return (
		<Button type="submit" disabled={pending} aria-busy={pending}>
			{pending ? t("listLoading") : t("listApply")}
		</Button>
	);
}
