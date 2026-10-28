import { FileText, Gem, Hotel, Inbox, Settings, Users } from "lucide-react";
import Link from "@/components/link";
import type { HousekeepingNavigationDomain } from "../navigation";

interface DomainRailProps {
	domains: readonly HousekeepingNavigationDomain[];
	activeDomainId: HousekeepingNavigationDomain["id"];
	ariaLabel: string;
}

function DomainIcon({ iconId }: Pick<HousekeepingNavigationDomain, "iconId">) {
	const Icon = {
		inbox: Inbox,
		users: Users,
		"file-text": FileText,
		gem: Gem,
		hotel: Hotel,
		settings: Settings,
	}[iconId];

	return <Icon aria-hidden="true" size={18} />;
}

export function DomainRail({
	domains,
	activeDomainId,
	ariaLabel,
}: DomainRailProps) {
	return (
		<nav aria-label={ariaLabel} className="w-full lg:w-20">
			<ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
				{domains.map((domain) => (
					<li key={domain.id} className="min-w-max lg:min-w-0">
						<Link
							href={domain.href}
							aria-current={domain.id === activeDomainId ? "page" : undefined}
							className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface)] hover:text-[var(--admin-text)] lg:justify-center"
						>
							<span data-domain-icon={domain.iconId}>
								<DomainIcon iconId={domain.iconId} />
							</span>
							<span className="lg:sr-only">{domain.label}</span>
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
