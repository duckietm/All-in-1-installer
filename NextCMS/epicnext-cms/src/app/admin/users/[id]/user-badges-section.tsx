"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { giveBadge, removeBadge } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";

interface BadgeInfo {
	id: number;
	badgeCode: string;
}

interface UserBadgesSectionProps {
	userId: number;
	badges: BadgeInfo[];
}

export function UserBadgesSection({ userId, badges }: UserBadgesSectionProps) {
	const { isPending, run } = useServerAction();
	const [newBadge, setNewBadge] = useState("");

	function handleAddBadge() {
		if (!newBadge.trim()) return;
		run(() => giveBadge({ userId, badgeCode: newBadge.trim() }), {
			successMessage: `Badge "${newBadge.trim()}" added.`,
			onSuccess: () => setNewBadge(""),
		});
	}

	function handleRemoveBadge(badgeCode: string) {
		run(() => removeBadge({ userId, badgeCode }), {
			successMessage: `Badge "${badgeCode}" removed.`,
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Badges ({badges.length})</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex gap-2">
					<Input
						value={newBadge}
						onChange={(e) => setNewBadge(e.target.value)}
						placeholder="Badge code..."
						onKeyDown={(e) => e.key === "Enter" && handleAddBadge()}
					/>
					<Button size="icon" onClick={handleAddBadge} disabled={isPending}>
						<Plus className="h-4 w-4" />
					</Button>
				</div>

				<div className="flex flex-wrap gap-2">
					{badges.map((badge) => (
						<div
							key={badge.id}
							className="group flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm hover:border-destructive/50 transition-colors"
						>
							<img
								src={`/api/imaging/badge?source=local&code=${encodeURIComponent(badge.badgeCode)}`}
								alt={badge.badgeCode}
								className="h-5 w-5"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = "none";
								}}
							/>
							<span>{badge.badgeCode}</span>
							<button
								type="button"
								onClick={() => handleRemoveBadge(badge.badgeCode)}
								disabled={isPending}
								className="ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive transition-opacity disabled:opacity-50"
								title={`Remove ${badge.badgeCode}`}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
					{badges.length === 0 && (
						<p className="text-sm text-muted-foreground">No badges</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
