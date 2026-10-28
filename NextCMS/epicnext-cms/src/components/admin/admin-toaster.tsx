import { Toaster } from "sonner";

/**
 * Toast host for the admin surfaces (the only place `toast()` is used). Kept out
 * of the root layout so public pages don't pay for the Sonner bundle.
 */
export function AdminToaster() {
	return (
		<Toaster
			position="top-right"
			richColors
			closeButton
			toastOptions={{
				style: {
					background: "var(--color-surface)",
					color: "var(--color-text-readable)",
					border:
						"1px solid color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
				},
			}}
		/>
	);
}
