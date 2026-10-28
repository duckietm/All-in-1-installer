"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";

interface Registration {
	id: number;
	userId: number;
	username: string;
	createdAt: Date;
}

interface Props {
	registrations: Registration[];
}

export function EventRegistrations({ registrations }: Props) {
	const t = useTranslations("pages.admin.events");

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("registrationsTitle", { count: registrations.length })}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{registrations.length === 0 ? (
					<div className="admin-empty">{t("noRegistrations")}</div>
				) : (
					<div className="divide-y max-h-[400px] overflow-y-auto">
						{registrations.map((r) => (
							<div
								key={r.id}
								className="flex items-center justify-between py-2"
							>
								<span className="text-sm font-medium">{r.username}</span>
								<span className="text-xs text-muted-foreground">
									{formatDate(new Date(r.createdAt))}
								</span>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
