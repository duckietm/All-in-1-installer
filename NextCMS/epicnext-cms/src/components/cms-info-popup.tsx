"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const cmsDetails = [
	["Edition", "EpicNext"],
	["Interface", "Modern CMS"],
	["Runtime", "Next.js App Router"],
];

const credits = [
	["Remco", "EpicNext direction and development"],
	["Life", "Next.js architecture and CMS refinements"],
];

const EXIT_MS = 180;

export function CmsInfoPopup() {
	const [open, setOpen] = useState(false);
	// The dialog used to unmount through AnimatePresence so its fade-out could
	// finish. With the animation in CSS the component holds it for the length of
	// the fade instead; this popup lives in the public footer, so pulling in
	// motion/react for it was not worth it.
	const [closing, setClosing] = useState(false);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Stable identity so the keydown effect below does not re-subscribe on every
	// render.
	const close = useCallback(() => {
		if (exitTimer.current) return;
		setClosing(true);
		exitTimer.current = setTimeout(() => {
			exitTimer.current = null;
			setOpen(false);
			setClosing(false);
		}, EXIT_MS);
	}, []);

	useEffect(
		() => () => {
			if (exitTimer.current) clearTimeout(exitTimer.current);
		},
		[],
	);

	useEffect(() => {
		if (window.location.hash === "#cms-info") setOpen(true);
	}, []);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, close]);

	return (
		<>
			<button
				type="button"
				className="cms-info-trigger"
				onClick={() => setOpen(true)}
			>
				EpicNext Info
			</button>
			{open ? (
				<div className="cms-info-layer">
					{/* A real button, so click-outside-to-dismiss is reachable by
					    keyboard and assistive tech instead of being a pointer-only
					    handler on a static element. The layer itself is
					    pointer-transparent so only these two children catch clicks. */}
					<button
						type="button"
						aria-label="Close CMS info"
						className={`cms-info-backdrop ${
							closing ? "cms-info-backdrop-exit" : "cms-info-backdrop-enter"
						}`}
						onClick={close}
					/>
					<section
						aria-labelledby="cms-info-title"
						aria-modal="true"
						className={`cms-info-dialog cms-info-dialog-layer ${
							closing ? "cms-info-dialog-exit" : "cms-info-dialog-enter"
						}`}
						role="dialog"
					>
						<button
							type="button"
							aria-label="Close CMS info"
							className="cms-info-close"
							onClick={close}
						>
							x
						</button>
						<div className="cms-info-kicker">CMS information</div>
						<h2 id="cms-info-title">EpicNext</h2>
						<div className="cms-info-badge">Modern Next.js CMS</div>
						<p className="cms-info-copy">
							A modern web layer for the hotel community, focused on fast
							navigation, clean administration, and a coherent EpicNext
							experience.
						</p>
						<dl className="cms-info-grid">
							{cmsDetails.map(([label, value]) => (
								<div key={label}>
									<dt>{label}</dt>
									<dd>{value}</dd>
								</div>
							))}
						</dl>
						<section className="cms-info-credit-list" aria-label="Credits">
							{credits.map(([name, role]) => (
								<div className="cms-info-credit" key={name}>
									<span>{name}</span>
									<small>{role}</small>
								</div>
							))}
						</section>
					</section>
				</div>
			) : null}
		</>
	);
}
