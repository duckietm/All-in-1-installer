"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	createEventType,
	deleteEventType,
	updateEventType,
} from "@/actions/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";

interface EventType {
	id: number;
	name: string;
	slug: string;
	description: string;
	color: string;
	icon: string;
	isActive: number;
	minRank: number;
}

interface Props {
	eventTypes: EventType[];
}

export function EventTypesManager({ eventTypes }: Props) {
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState({
		name: "",
		slug: "",
		description: "",
		color: "#3b82f6",
		icon: "calendar",
		minRank: 0,
	});

	function resetForm() {
		setForm({
			name: "",
			slug: "",
			description: "",
			color: "#3b82f6",
			icon: "calendar",
			minRank: 0,
		});
		setEditingId(null);
		setShowForm(false);
	}

	function handleEdit(et: EventType) {
		setForm({
			name: et.name,
			slug: et.slug,
			description: et.description,
			color: et.color,
			icon: et.icon,
			minRank: et.minRank,
		});
		setEditingId(et.id);
		setShowForm(true);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (editingId) {
			run(() => updateEventType({ id: editingId, ...form }), {
				successMessage: "Event type updated!",
				onSuccess: resetForm,
			});
		} else {
			run(() => createEventType(form), {
				successMessage: "Event type created!",
				onSuccess: resetForm,
			});
		}
	}

	function handleDelete(id: number) {
		run(() => deleteEventType({ id }), {
			successMessage: "Event type deleted!",
		});
	}

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<Button onClick={() => setShowForm(!showForm)}>
					<Plus className="h-4 w-4 mr-2" />
					New Type
				</Button>
			</div>

			{showForm && (
				<Card>
					<CardHeader>
						<CardTitle>
							{editingId ? "Edit Event Type" : "New Event Type"}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label>Name</Label>
									<Input
										value={form.name}
										onChange={(e) => setForm({ ...form, name: e.target.value })}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label>Slug</Label>
									<Input
										value={form.slug}
										onChange={(e) => setForm({ ...form, slug: e.target.value })}
										required
										placeholder="game-night"
									/>
								</div>
								<div className="space-y-2">
									<Label>Color</Label>
									<Input
										type="color"
										value={form.color}
										onChange={(e) =>
											setForm({ ...form, color: e.target.value })
										}
									/>
								</div>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label>Description</Label>
									<Input
										value={form.description}
										onChange={(e) =>
											setForm({ ...form, description: e.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Rank minimo (0 = tutti)</Label>
									<Input
										type="number"
										min={0}
										max={7}
										value={form.minRank}
										onChange={(e) =>
											setForm({
												...form,
												minRank: parseInt(e.target.value, 10) || 0,
											})
										}
									/>
									<p className="text-[10px] text-muted-foreground">
										0=Tutti, 3=Mod+, 4=Staff+, 6=Admin+
									</p>
								</div>
							</div>
							<div className="flex gap-2 justify-end">
								<Button type="button" variant="outline" onClick={resetForm}>
									Cancel
								</Button>
								<Button type="submit" disabled={isPending}>
									{isPending ? "Saving..." : editingId ? "Update" : "Create"}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="p-0">
					<div className="divide-y">
						{eventTypes.length === 0 && (
							<div className="p-6 text-center text-muted-foreground">
								No event types yet. Create your first one above.
							</div>
						)}
						{eventTypes.map((et) => (
							<div
								key={et.id}
								className="flex items-center justify-between px-4 py-3"
							>
								<div className="flex items-center gap-3">
									<div
										className="w-3 h-3 rounded-full"
										style={{ backgroundColor: et.color }}
									/>
									<div>
										<span className="font-medium">{et.name}</span>
										<span className="ml-2 text-xs text-muted-foreground">
											{et.slug}
										</span>
									</div>
									<Badge variant={et.isActive ? "default" : "outline"}>
										{et.isActive ? "Active" : "Inactive"}
									</Badge>
									{et.minRank > 0 && (
										<Badge variant="secondary" className="text-[10px]">
											Rank {et.minRank}+
										</Badge>
									)}
								</div>
								<div className="flex gap-1">
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleEdit(et)}
									>
										<Pencil className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleDelete(et.id)}
									>
										<Trash2 className="h-4 w-4 text-destructive" />
									</Button>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
