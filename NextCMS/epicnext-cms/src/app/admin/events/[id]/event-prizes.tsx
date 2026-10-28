"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addEventPrize, deleteEventPrize } from "@/actions/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useServerAction } from "@/hooks/use-server-action";
import type { EventPrizeInput } from "@/lib/validators/event";

type PrizeType = "badge" | "credits" | "pixels" | "points" | "item";

interface Prize {
	id: number;
	position: number;
	prizeType: string;
	badgeCode: string | null;
	credits: number;
	pixels: number;
	points: number;
	itemId: number | null;
	description: string;
}

interface Props {
	eventId: number;
	prizes: Prize[];
}

export function EventPrizesManager({ eventId, prizes }: Props) {
	const t = useTranslations("pages.admin.events");
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [form, setForm] = useState<EventPrizeInput>({
		eventId,
		position: prizes.length + 1,
		prizeType: "badge",
		badgeCode: "",
		credits: 0,
		pixels: 0,
		points: 0,
		description: "",
	});

	function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		run(() => addEventPrize(form), {
			successMessage: "Prize added!",
			onSuccess: () => {
				setShowForm(false);
				setForm({
					...form,
					position: form.position + 1,
					badgeCode: "",
					description: "",
				});
			},
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>{t("statPrizes")}</CardTitle>
				<Button size="sm" onClick={() => setShowForm(!showForm)}>
					<Plus className="h-4 w-4 mr-1" /> {t("addPrize")}
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{showForm && (
					<form
						onSubmit={handleAdd}
						className="border rounded-lg p-4 space-y-3"
					>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							<div className="space-y-1">
								<Label>Position</Label>
								<Input
									type="number"
									value={form.position}
									onChange={(e) =>
										setForm({ ...form, position: Number(e.target.value) })
									}
								/>
							</div>
							<div className="space-y-1">
								<Label>Type</Label>
								<Select
									value={form.prizeType}
									onValueChange={(v) =>
										setForm({ ...form, prizeType: v as PrizeType })
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="badge">Badge</SelectItem>
										<SelectItem value="credits">Credits</SelectItem>
										<SelectItem value="pixels">Pixels</SelectItem>
										<SelectItem value="points">Points</SelectItem>
										<SelectItem value="item">Item</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label>Badge Code</Label>
								<Input
									value={form.badgeCode ?? ""}
									onChange={(e) =>
										setForm({ ...form, badgeCode: e.target.value })
									}
									placeholder="ACH_..."
								/>
							</div>
							<div className="space-y-1">
								<Label>Credits</Label>
								<Input
									type="number"
									value={form.credits}
									onChange={(e) =>
										setForm({ ...form, credits: Number(e.target.value) })
									}
								/>
							</div>
						</div>
						<div className="space-y-1">
							<Label>Description</Label>
							<Input
								value={form.description}
								onChange={(e) =>
									setForm({ ...form, description: e.target.value })
								}
							/>
						</div>
						<div className="flex gap-2 justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setShowForm(false)}
							>
								Cancel
							</Button>
							<Button type="submit" size="sm" disabled={isPending}>
								Add
							</Button>
						</div>
					</form>
				)}

				{prizes.length === 0 && !showForm && (
					<div className="admin-empty">{t("noPrizes")}</div>
				)}

				{prizes.map((prize) => (
					<div
						key={prize.id}
						className="flex items-center justify-between border rounded-lg px-4 py-3"
					>
						<div className="flex items-center gap-3">
							<span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent font-bold text-sm">
								#{prize.position}
							</span>
							<div>
								<div className="flex items-center gap-2">
									<Badge variant="secondary">{prize.prizeType}</Badge>
									{prize.badgeCode && (
										<span className="text-sm font-mono">{prize.badgeCode}</span>
									)}
									{prize.credits > 0 && (
										<span className="text-sm">{prize.credits} credits</span>
									)}
									{prize.pixels > 0 && (
										<span className="text-sm">{prize.pixels} pixels</span>
									)}
									{prize.points > 0 && (
										<span className="text-sm">{prize.points} points</span>
									)}
								</div>
								{prize.description && (
									<p className="text-xs text-muted-foreground">
										{prize.description}
									</p>
								)}
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={() =>
								run(() => deleteEventPrize({ id: prize.id }), {
									successMessage: "Prize removed",
								})
							}
						>
							<Trash2 className="h-4 w-4 text-destructive" />
						</Button>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
