"use client";

import { AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "danger" | "default";
	loading?: boolean;
	onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	variant = "danger",
	loading,
	onConfirm,
}: ConfirmDialogProps) {
	const [busy, setBusy] = useState(false);
	const [mounted, setMounted] = useState(false);
	const isLoading = loading ?? busy;

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !isLoading) onOpenChange(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, isLoading, onOpenChange]);

	async function handleConfirm() {
		setBusy(true);
		try {
			await onConfirm();
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	}

	if (!mounted) return null;

	return createPortal(
		<AnimatePresence>
			{open ? (
				<motion.div
					key="confirm-popup"
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="confirm-dialog-title"
					aria-describedby="confirm-dialog-desc"
					className="fixed left-1/2 top-1/2 z-[200] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl"
					initial={{ opacity: 0, scale: 0.95, y: -4 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: -4 }}
					transition={{ duration: 0.15, ease: "easeOut" }}
				>
					<div className="flex flex-col gap-2 text-left">
						<div className="flex items-center gap-2.5">
							{variant === "danger" && (
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--admin-error)]/15">
									<AlertTriangle className="h-4 w-4 text-[var(--admin-error)]" />
								</div>
							)}
							<h2
								id="confirm-dialog-title"
								className="text-sm font-semibold text-[var(--admin-text)]"
							>
								{title}
							</h2>
						</div>
						<p
							id="confirm-dialog-desc"
							className="text-xs text-[var(--admin-text-muted)]"
						>
							{description}
						</p>
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isLoading}
							onClick={() => onOpenChange(false)}
						>
							{cancelLabel}
						</Button>
						<Button
							type="button"
							variant={variant === "danger" ? "destructive" : "default"}
							size="sm"
							disabled={isLoading}
							onClick={handleConfirm}
							className={cn(
								variant === "danger" &&
									"bg-destructive text-destructive-foreground",
							)}
							autoFocus
						>
							{confirmLabel}
						</Button>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>,
		document.body,
	);
}

export type ConfirmOptions = {
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "danger" | "default";
};

/** Imperative confirm — returns a Promise. Render `{dialog}` in the tree. */
export function useConfirmDialog() {
	const [opts, setOpts] = useState<(ConfirmOptions & { open: boolean }) | null>(
		null,
	);
	const resolver = useRef<((value: boolean) => void) | null>(null);

	const confirm = useCallback((options: ConfirmOptions) => {
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve;
			setOpts({ ...options, open: true });
		});
	}, []);

	const settle = useCallback((value: boolean) => {
		const resolve = resolver.current;
		resolver.current = null;
		setOpts(null);
		resolve?.(value);
	}, []);

	const dialog = opts ? (
		<ConfirmDialog
			open={opts.open}
			onOpenChange={(open) => {
				if (!open) settle(false);
			}}
			title={opts.title}
			description={opts.description}
			confirmLabel={opts.confirmLabel}
			cancelLabel={opts.cancelLabel}
			variant={opts.variant}
			onConfirm={() => settle(true)}
		/>
	) : null;

	return { confirm, dialog };
}
