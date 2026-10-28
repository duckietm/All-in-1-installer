"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createBanner, deleteBanner, updateBanner } from "@/actions/banners";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/hooks/use-server-action";

interface Banner {
	id: number;
	title: string;
	subtitle: string;
	image: string;
	link: string;
	color: string;
	isActive: number;
	sortOrder: number;
	startDate: string | null;
	endDate: string | null;
}

interface Props {
	banners: Banner[];
}

export function BannersManager({ banners }: Props) {
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState({
		title: "",
		subtitle: "",
		image: "",
		link: "",
		color: "",
		isActive: 1,
		sortOrder: 0,
		startDate: "" as string | null,
		endDate: "" as string | null,
	});

	function resetForm() {
		setForm({
			title: "",
			subtitle: "",
			image: "",
			link: "",
			color: "",
			isActive: 1,
			sortOrder: 0,
			startDate: "",
			endDate: "",
		});
		setEditingId(null);
		setShowForm(false);
	}

	function handleEdit(b: Banner) {
		setForm({
			title: b.title,
			subtitle: b.subtitle,
			image: b.image,
			link: b.link,
			color: b.color,
			isActive: b.isActive,
			sortOrder: b.sortOrder,
			startDate: b.startDate,
			endDate: b.endDate,
		});
		setEditingId(b.id);
		setShowForm(true);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const data = {
			...form,
			startDate: form.startDate || null,
			endDate: form.endDate || null,
		};
		if (editingId) {
			run(() => updateBanner({ id: editingId, ...data }), {
				successMessage: "Banner updated!",
			});
		} else {
			run(() => createBanner(data), { successMessage: "Banner created!" });
		}
		resetForm();
	}

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<Button
					onClick={() => {
						resetForm();
						setShowForm(!showForm);
					}}
				>
					<Plus className="h-4 w-4 mr-2" /> New Banner
				</Button>
			</div>

			{showForm && (
				<Card>
					<CardHeader>
						<CardTitle>{editingId ? "Edit Banner" : "New Banner"}</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label>Title</Label>
									<Input
										value={form.title}
										onChange={(e) =>
											setForm({ ...form, title: e.target.value })
										}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label>Subtitle</Label>
									<Input
										value={form.subtitle}
										onChange={(e) =>
											setForm({ ...form, subtitle: e.target.value })
										}
									/>
								</div>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label>Image URL</Label>
									<Input
										value={form.image}
										onChange={(e) =>
											setForm({ ...form, image: e.target.value })
										}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label>Link URL</Label>
									<Input
										value={form.link}
										onChange={(e) => setForm({ ...form, link: e.target.value })}
									/>
								</div>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label>Color</Label>
									<Input
										type="color"
										value={form.color || "#000000"}
										onChange={(e) =>
											setForm({ ...form, color: e.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Start Date</Label>
									<DateTimePicker
										value={form.startDate}
										onChange={(d) =>
											setForm({
												...form,
												startDate: d ? d.toISOString() : null,
											})
										}
										placeholder="Select start date"
									/>
								</div>
								<div className="space-y-2">
									<Label>End Date</Label>
									<DateTimePicker
										value={form.endDate}
										onChange={(d) =>
											setForm({ ...form, endDate: d ? d.toISOString() : null })
										}
										placeholder="Select end date"
									/>
								</div>
							</div>
							<div className="flex gap-6">
								<div className="flex items-center gap-2">
									<Switch
										id="banner-active"
										checked={form.isActive === 1}
										onCheckedChange={(v) =>
											setForm({ ...form, isActive: v ? 1 : 0 })
										}
									/>
									<Label htmlFor="banner-active">Active</Label>
								</div>
								<div className="space-y-2 flex items-center gap-2">
									<Label>Order</Label>
									<Input
										type="number"
										className="w-20"
										value={form.sortOrder}
										onChange={(e) =>
											setForm({ ...form, sortOrder: Number(e.target.value) })
										}
									/>
								</div>
							</div>
							<div className="flex gap-2 justify-end">
								<Button type="button" variant="outline" onClick={resetForm}>
									Cancel
								</Button>
								<Button type="submit" disabled={isPending}>
									{editingId ? "Update" : "Create"}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			)}

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{banners.length === 0 && (
					<p className="text-muted-foreground col-span-full text-center py-8">
						No banners yet.
					</p>
				)}
				{banners.map((b) => (
					<Card key={b.id} className="overflow-hidden">
						{b.image && (
							<div
								className="h-32 bg-cover bg-center"
								style={{ backgroundImage: `url(${b.image})` }}
							/>
						)}
						<CardContent className="p-4">
							<div className="flex items-start justify-between">
								<div>
									<h3 className="font-medium">{b.title}</h3>
									{b.subtitle && (
										<p className="text-xs text-muted-foreground">
											{b.subtitle}
										</p>
									)}
									<div className="flex gap-1 mt-2">
										<Badge variant={b.isActive ? "default" : "outline"}>
											{b.isActive ? "Active" : "Inactive"}
										</Badge>
										{b.startDate && (
											<Badge variant="secondary">Scheduled</Badge>
										)}
									</div>
								</div>
								<div className="flex gap-1">
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => handleEdit(b)}
									>
										<Pencil className="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() =>
											run(() => deleteBanner({ id: b.id }), {
												successMessage: "Banner deleted",
											})
										}
									>
										<Trash2 className="h-3.5 w-3.5 text-destructive" />
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
