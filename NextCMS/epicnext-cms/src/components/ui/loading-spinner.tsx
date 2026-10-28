type LoadingSpinnerProps = {
	className?: string;
	accentVar?: string;
};

/** Centered pulsing spinner used across site and admin loading.tsx placeholders. */
export function LoadingSpinner({
	className,
	accentVar = "var(--color-primary)",
}: LoadingSpinnerProps) {
	return (
		<div
			style={{ display: "flex", justifyContent: "center", padding: "4rem 0" }}
			className={className}
		>
			<div
				className="animate-spin w-8 h-8 border-4 rounded-full"
				style={{
					borderColor: accentVar,
					borderTopColor: "transparent",
				}}
			/>
		</div>
	);
}
