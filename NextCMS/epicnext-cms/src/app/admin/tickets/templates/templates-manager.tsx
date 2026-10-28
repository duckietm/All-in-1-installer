"use client";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	createTemplate,
	deleteTemplate,
	updateTemplate,
} from "@/actions/ticket-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";

interface Template {
	id: number;
	title: string;
	content: string;
	category: string;
	sortOrder: number;
}

interface Props {
	templates: Template[];
}

export function TicketTemplatesManager({ templates }: Props) {
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState({
		title: "",
		content: "",
		category: "general",
		sortOrder: 0,
	});

	function resetForm() {
		setForm({ title: "", content: "", category: "general", sortOrder: 0 });
		setEditingId(null);
		setShowForm(false);
	}

	function handleEdit(t: Template) {
		setForm({
			title: t.title,
			content: t.content,
			category: t.category,
			sortOrder: t.sortOrder,
		});
		setEditingId(t.id);
		setShowForm(true);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (editingId) {
			run(() => updateTemplate({ id: editingId, ...form }), {
				successMessage: "Template updated!",
				onSuccess: resetForm,
			});
		} else {
			run(() => createTemplate(form), {
				successMessage: "Template created!",
				onSuccess: resetForm,
			});
		}
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
					<Plus className="h-4 w-4 mr-2" /> New Template
				</Button>
			</div>

			{showForm && (
				<Card>
					<CardHeader>
						<CardTitle>
							{editingId ? "Edit Template" : "New Template"}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
									<Label>Category</Label>
									<Input
										value={form.category}
										onChange={(e) =>
											setForm({ ...form, category: e.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Sort Order</Label>
									<Input
										type="number"
										value={form.sortOrder}
										onChange={(e) =>
											setForm({ ...form, sortOrder: Number(e.target.value) })
										}
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Content</Label>
								<textarea
									className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[120px]"
									value={form.content}
									onChange={(e) =>
										setForm({ ...form, content: e.target.value })
									}
									required
								/>
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

			<div className="space-y-2">
				{templates.length === 0 && (
					<p className="text-muted-foreground text-center py-8">
						No templates yet.
					</p>
				)}
				{templates.map((t) => (
					<Card key={t.id}>
						<CardContent className="p-4">
							<div className="flex items-start justify-between">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<span className="font-medium text-sm">{t.title}</span>
										<Badge variant="secondary">{t.category}</Badge>
									</div>
									<p className="text-sm text-muted-foreground whitespace-pre-wrap">
										{t.content}
									</p>
								</div>
								<div className="flex gap-1 shrink-0 ml-2">
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => navigator.clipboard.writeText(t.content)}
									>
										<Copy className="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => handleEdit(t)}
									>
										<Pencil className="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() =>
											run(() => deleteTemplate({ id: t.id }), {
												successMessage: "Deleted",
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
