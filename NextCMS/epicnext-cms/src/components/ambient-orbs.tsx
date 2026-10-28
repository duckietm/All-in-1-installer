"use client";

import { useEffect, useState } from "react";

interface Orb {
	id: number;
	x: number;
	y: number;
	size: number;
	delay: number;
	duration: number;
	color: string;
}

export function AmbientOrbs() {
	const [orbs, setOrbs] = useState<Orb[]>([]);

	useEffect(() => {
		const colors = [
			"var(--color-primary)",
			"var(--color-accent)",
			"color-mix(in srgb, var(--color-primary) 60%, var(--color-accent))",
		];
		const items: Orb[] = Array.from({ length: 3 }, (_, i) => ({
			id: i,
			x: 15 + Math.random() * 70,
			y: 10 + Math.random() * 70,
			size: 120 + Math.random() * 180,
			delay: Math.random() * 3,
			duration: 8 + Math.random() * 6,
			color: colors[i],
		}));
		setOrbs(items);
	}, []);

	if (orbs.length === 0) return null;

	return (
		<div
			className="absolute inset-0 overflow-hidden pointer-events-none"
			style={{ zIndex: 1 }}
		>
			{orbs.map((orb) => (
				<div
					key={orb.id}
					className="absolute rounded-full"
					style={{
						left: `${orb.x}%`,
						top: `${orb.y}%`,
						width: orb.size,
						height: orb.size,
						background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
						opacity: 0.12,
						animation: `ambient-drift-${orb.id} ${orb.duration}s ease-in-out ${orb.delay}s infinite alternate`,
					}}
				/>
			))}
			<style>{`
				${orbs
					.map(
						(orb) => `
				@keyframes ambient-drift-${orb.id} {
					0% { transform: translate(0, 0) scale(1); }
					33% { transform: translate(${(Math.random() > 0.5 ? "" : "-") + (20 + Math.random() * 30)}px, ${(Math.random() > 0.5 ? "" : "-") + (20 + Math.random() * 30)}px) scale(${0.8 + Math.random() * 0.4}); }
					66% { transform: translate(${(Math.random() > 0.5 ? "" : "-") + (10 + Math.random() * 40)}px, ${(Math.random() > 0.5 ? "" : "-") + (15 + Math.random() * 35)}px) scale(${0.9 + Math.random() * 0.3}); }
					100% { transform: translate(0, 0) scale(1); }
				}`,
					)
					.join("\n")}
			`}</style>
		</div>
	);
}
