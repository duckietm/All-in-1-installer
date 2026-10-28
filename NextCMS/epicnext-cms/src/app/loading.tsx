export default function RootLoading() {
	return (
		<div style={{ maxWidth: 1280, margin: "0 auto", padding: "1.5rem 1rem" }}>
			<div className="flex flex-col gap-10 pb-14">
				<div
					className="h-16 animate-pulse rounded-xl"
					style={{
						background:
							"color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
					}}
				/>
				<div
					className="relative overflow-hidden rounded-2xl"
					style={{ height: 280 }}
				>
					<div
						className="h-full w-full animate-pulse"
						style={{
							background:
								"color-mix(in srgb, var(--color-text-muted) 6%, transparent)",
						}}
					/>
				</div>
				<div className="grid grid-cols-3 gap-4">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-32 animate-pulse rounded-xl"
							style={{
								background:
									"color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
							}}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
