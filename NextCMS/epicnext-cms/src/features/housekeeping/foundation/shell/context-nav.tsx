import Link from "@/components/link";

interface ContextNavProps {
	items: readonly { id: string; href: string; label: string }[];
	ariaLabel: string;
}

export function ContextNav({ items, ariaLabel }: ContextNavProps) {
	return (
		<nav aria-label={ariaLabel} className="min-w-0">
			<ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
				{items.map((item) => (
					<li key={item.id} className="min-w-max">
						<Link
							href={item.href}
							className="block rounded-md px-3 py-2 text-sm text-[var(--admin-text-muted)] hover:bg-[var(--admin-canvas)] hover:text-[var(--admin-text)]"
						>
							{item.label}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
