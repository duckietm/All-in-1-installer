"use client";
import { useTranslations } from "next-intl";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);
}
export interface ArticlePreviewData {
	title: string;
	image: string;
	summary: string;
	body: string;
}
export function ArticlePreview({
	data,
	onClose,
	title,
}: {
	data: ArticlePreviewData | null;
	onClose: () => void;
	title?: string;
}) {
	const t = useTranslations("pages.admin.articles.form");
	const document = data
		? `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light;background:Canvas;color:CanvasText}body{font:16px/1.6 system-ui;padding:20px;margin:auto;max-width:760px;overflow-wrap:anywhere}img{max-width:100%;height:auto}h1{line-height:1.2}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(data.title)}</h1>${data.image ? `<img src="${escapeHtml(data.image)}" alt="">` : ""}<p>${escapeHtml(data.summary)}</p>${data.body}</body></html>`
		: "";
	return (
		<Dialog
			open={!!data}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-4xl h-[85dvh] flex flex-col min-h-0">
				<DialogHeader>
					<DialogTitle>{title ?? t("previewTitle")}</DialogTitle>
				</DialogHeader>
				<p className="text-xs text-muted-foreground">
					{t("previewDescription")}
				</p>
				<iframe
					title={title ?? t("previewFrame")}
					sandbox=""
					srcDoc={document}
					className="min-h-0 flex-1 w-full bg-background rounded border"
				/>
			</DialogContent>
		</Dialog>
	);
}
