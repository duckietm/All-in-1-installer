"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side photo gallery for the public Photos page. Renders the same
 * card grid as before, but each tile is now a button that opens the photo in
 * a full-screen lightbox overlay. The overlay is a fixed, full-viewport layer
 * toggled by state — closes on backdrop click, on the ✕ button, or with Esc.
 *
 * Photos are pre-shaped on the server (caption strings already translated) so
 * this component carries no db/i18n dependency.
 */
export type LightboxPhoto = {
	id: string;
	url: string;
	alt: string;
	date: string;
	user: string;
};

const EXIT_MS = 180;

export function PhotoLightbox({ photos }: { photos: LightboxPhoto[] }) {
	// Index of the photo shown in the lightbox, or null when closed.
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	// Kept mounted for the length of the fade-out, then removed. Previously
	// AnimatePresence owned that delay; with the animation in CSS the component
	// has to hold the overlay itself.
	const [closing, setClosing] = useState(false);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// openIndex is numeric array index, guarded by null check
	const active = openIndex !== null ? photos[openIndex] : null;

	const close = useCallback(() => {
		if (exitTimer.current) return;
		setClosing(true);
		exitTimer.current = setTimeout(() => {
			exitTimer.current = null;
			setOpenIndex(null);
			setClosing(false);
		}, EXIT_MS);
	}, []);

	const open = useCallback((index: number) => {
		if (exitTimer.current) {
			clearTimeout(exitTimer.current);
			exitTimer.current = null;
		}
		setClosing(false);
		setOpenIndex(index);
	}, []);

	// Never leave a pending timer behind on unmount.
	useEffect(
		() => () => {
			if (exitTimer.current) clearTimeout(exitTimer.current);
		},
		[],
	);

	// Esc-to-close + lock background scroll while the overlay is open.
	useEffect(() => {
		if (active == null) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") close();
		}
		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [active, close]);

	return (
		<>
			<div className="card-grid sm-2 md-3 lg-4" style={{ padding: "1rem" }}>
				{photos.map((p, i) => (
					<button
						key={p.id}
						type="button"
						onClick={() => open(i)}
						className="card hover"
						style={{
							padding: 0,
							overflow: "hidden",
							border: 0,
							background: "var(--color-surface)",
							cursor: "zoom-in",
							textAlign: "left",
							font: "inherit",
							color: "inherit",
							display: "block",
							width: "100%",
						}}
						aria-label={p.alt}
					>
						<img
							src={p.url}
							alt={p.alt}
							loading="lazy"
							decoding="async"
							style={{ width: "100%", height: "auto", display: "block" }}
						/>
						<div style={{ padding: "0.7rem 0.85rem" }}>
							<p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
								{p.date}
							</p>
							<p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
								{p.user}
							</p>
						</div>
					</button>
				))}
			</div>

			{active ? (
				<div
					// .lightbox-enter / .lightbox-exit replace the AnimatePresence
					// pair: motion/react is a ~43 KB chunk and the Photos page is
					// public. The fade-out is driven by `closing`.
					className={closing ? "lightbox-exit" : "lightbox-enter"}
					// onMouseDown, not onClick: the backdrop is a pointer-only
					// convenience dismiss. Keyboard users already have Escape and the
					// ✕ button, and a <div> cannot take focus to host a key handler.
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) close();
					}}
					role="dialog"
					aria-modal="true"
					aria-label={active.alt}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 1000,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "1.5rem",
						background: "rgba(0, 0, 0, 0.82)",
						backdropFilter: "blur(8px)",
						cursor: "zoom-out",
					}}
				>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						style={{
							position: "absolute",
							top: "1rem",
							right: "1rem",
							// 44px touch target (was 2.5rem/40px).
							width: "2.75rem",
							height: "2.75rem",
							borderRadius: "999px",
							border: 0,
							background: "rgba(255, 255, 255, 0.16)",
							color: "#fff",
							fontSize: "1.4rem",
							lineHeight: 1,
							cursor: "pointer",
						}}
					>
						✕
					</button>
					{/* Clicking the dialog backdrop (not the figure) closes the lightbox. */}
					<figure
						style={{
							margin: 0,
							maxWidth: "min(92vw, 1100px)",
							maxHeight: "90vh",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: "0.75rem",
							cursor: "default",
						}}
					>
						<img
							src={active.url}
							alt={active.alt}
							style={{
								maxWidth: "100%",
								maxHeight: "78vh",
								width: "auto",
								height: "auto",
								display: "block",
								borderRadius: "var(--radius-md)",
								boxShadow: "var(--shadow-card-hover)",
								scale: active ? "1" : "0.95",
							}}
						/>
						<figcaption
							style={{
								color: "rgba(255, 255, 255, 0.85)",
								fontSize: "0.9rem",
								textAlign: "center",
							}}
						>
							{active.date} · {active.user}
						</figcaption>
					</figure>
				</div>
			) : null}
		</>
	);
}
