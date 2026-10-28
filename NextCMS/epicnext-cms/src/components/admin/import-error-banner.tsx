import { AlertCircle } from "lucide-react";

/** Shared destructive banner for the import/admin clients. */
export function ImportErrorBanner({ error }: { error: string }) {
	return (
		<div
			role="alert"
			className="rounded-lg border px-4 py-3 text-sm bg-destructive/10 border-destructive/20 text-destructive flex items-center gap-2"
		>
			<AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
			<span className="min-w-0 break-words">{error}</span>
		</div>
	);
}
