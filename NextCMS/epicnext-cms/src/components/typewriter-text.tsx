"use client";

import { useEffect, useState } from "react";

export function TypewriterText({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const [displayed, setDisplayed] = useState(text[0] ?? "");
	const [done, setDone] = useState(text.length <= 1);

	useEffect(() => {
		setDisplayed(text[0] ?? "");
		setDone(text.length <= 1);

		// Respect "reduce motion": show the full text instead of animating the
		// letters in, since the blinking cursor is pure CSS-driven decoration.
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setDisplayed(text);
			setDone(true);
			return;
		}

		let i = 1;
		const id = setInterval(() => {
			if (i < text.length) {
				setDisplayed(text.slice(0, i + 1));
				i++;
			} else {
				clearInterval(id);
				setDone(true);
			}
		}, 40);
		return () => clearInterval(id);
	}, [text]);

	return (
		<>
			<span className="sr-only">{text}</span>
			{/* A plain span: this used to be a motion.span with no animation
			    props at all, so it only cost the ~43 KB motion/react chunk. */}
			<span
				className={`${className ?? ""} ${!done ? "typing-cursor" : ""}`}
				aria-hidden
			>
				{displayed}
			</span>
		</>
	);
}
