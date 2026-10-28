import {
	Calendar,
	Clock,
	ExternalLink,
	Globe,
	MonitorSmartphone,
	Shield,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";

interface UserAccountInfoProps {
	user: {
		accountCreated: number;
		lastLogin: number | null;
		ipRegister: string;
		ipCurrent: string;
		twoFactorConfirmed: number;
		machine_id: string;
		mail: string;
		gender: string;
	};
}

export function UserAccountInfo({ user }: UserAccountInfoProps) {
	const t = useTranslations("pages.admin.users.presentation");
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("accountDetails")}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-3">
						<div className="flex items-center gap-3 text-sm">
							<Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">{t("registered")}</span>
							<span className="ml-auto font-medium">
								{formatDate(new Date(user.accountCreated * 1000), "date")}
							</span>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<Clock className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">{t("lastLogin")}</span>
							<span className="ml-auto font-medium">
								{user.lastLogin
									? formatDate(new Date(user.lastLogin * 1000))
									: t("never")}
							</span>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<Globe className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">{t("ipRegister")}</span>
							<span className="ml-auto flex items-center gap-1.5">
								<code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
									{user.ipRegister}
								</code>
								<Link
									href={`/admin/users?search=${user.ipRegister}`}
									title={t("findIp")}
								>
									<ExternalLink className="h-3 w-3 text-primary" />
								</Link>
							</span>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<Globe className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">{t("ipCurrent")}</span>
							<span className="ml-auto flex items-center gap-1.5">
								<code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
									{user.ipCurrent}
								</code>
								<Link
									href={`/admin/users?search=${user.ipCurrent}`}
									title={t("findIp")}
								>
									<ExternalLink className="h-3 w-3 text-primary" />
								</Link>
							</span>
						</div>
					</div>
					<div className="space-y-3">
						<div className="flex items-center gap-3 text-sm">
							<Shield className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">2FA</span>
							<Badge
								variant={user.twoFactorConfirmed ? "default" : "outline"}
								className="ml-auto"
							>
								{user.twoFactorConfirmed ? t("enabled") : t("disabled")}
							</Badge>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<MonitorSmartphone className="h-4 w-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground">{t("machineId")}</span>
							<code className="ml-auto text-xs font-mono bg-muted px-2 py-0.5 rounded truncate max-w-[180px]">
								{user.machine_id || t("unavailable")}
							</code>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<span className="text-muted-foreground">{t("email")}</span>
							<span className="ml-auto font-medium">{user.mail}</span>
						</div>
						<div className="flex items-center gap-3 text-sm">
							<span className="text-muted-foreground">{t("gender")}</span>
							<Badge variant="outline" className="ml-auto">
								{user.gender}
							</Badge>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
