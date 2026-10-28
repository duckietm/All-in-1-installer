"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addEventWinner } from "@/actions/events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";

interface Winner {
	id: number;
	userId: number;
	position: number;
	username: string;
	createdAt: Date;
}

interface Props {
	eventId: number;
	winners: Winner[];
}

export function EventWinnersManager({ eventId, winners }: Props) {
	const t = useTranslations("pages.admin.events");
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [userId, setUserId] = useState("");
	const [position, setPosition] = useState(winners.length + 1);

	function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		run(() => addEventWinner({ eventId, userId: Number(userId), position }), {
			successMessage: "Winner added!",
			onSuccess: () => {
				setShowForm(false);
				setUserId("");
				setPosition(position + 1);
			},
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>{t("statWinners")}</CardTitle>
				<Button size="sm" onClick={() => setShowForm(!showForm)}>
					<Plus className="h-4 w-4 mr-1" /> {t("addWinner")}
				</Button>
			</CardHeader>
			<CardContent className="space-y-3">
				{showForm && (
					<form
						onSubmit={handleAdd}
						className="border rounded-lg p-4 flex gap-3 items-end"
					>
						<div className="space-y-1">
							<Label>User ID</Label>
							<Input
								type="number"
								value={userId}
								onChange={(e) => setUserId(e.target.value)}
								required
								placeholder="12345"
							/>
						</div>
						<div className="space-y-1">
							<Label>Position</Label>
							<Input
								type="number"
								value={position}
								onChange={(e) => setPosition(Number(e.target.value))}
								min={1}
							/>
						</div>
						<Button type="submit" size="sm" disabled={isPending}>
							Add
						</Button>
					</form>
				)}

				{winners.length === 0 && !showForm && (
					<div className="admin-empty">{t("noWinners")}</div>
				)}

				<div className="divide-y">
					{winners.map((w) => (
						<div key={w.id} className="flex items-center gap-3 py-2.5">
							<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
								{w.position}
							</span>
							<span className="font-medium text-sm">{w.username}</span>
							<span className="text-xs text-muted-foreground ml-auto">
								{formatDate(new Date(w.createdAt), "date")}
							</span>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
