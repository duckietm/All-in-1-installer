"use client";

import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	addPollQuestion,
	deletePollQuestion,
	updatePollQuestion,
} from "@/actions/polls";
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
import type { PollQuestionInput } from "@/lib/validators/poll";

interface Question {
	id: number;
	question: string;
	type: string;
	sortOrder: number;
	options: string;
}

interface Props {
	pollId: number;
	questions: Question[];
}

type PollQuestionUpdateInput = PollQuestionInput & { id: number };

export function PollQuestionsManager({ pollId, questions }: Props) {
	const t = useTranslations("pages.admin.polls");
	const { run, isPending } = useServerAction();
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState<PollQuestionInput>({
		pollId,
		question: "",
		type: "single",
		sortOrder: questions.length,
		options: "",
	});

	function resetForm() {
		setForm({
			pollId,
			question: "",
			type: "single",
			sortOrder: questions.length,
			options: "",
		});
		setEditingId(null);
		setShowForm(false);
	}

	function handleEdit(q: Question) {
		setForm({
			pollId,
			question: q.question,
			type: q.type as PollQuestionInput["type"],
			sortOrder: q.sortOrder,
			options: q.options,
		});
		setEditingId(q.id);
		setShowForm(true);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (editingId) {
			run(
				() =>
					updatePollQuestion({
						id: editingId,
						...form,
					} as PollQuestionUpdateInput),
				{
					successMessage: "Question updated!",
				},
			);
		} else {
			run(() => addPollQuestion(form), {
				successMessage: "Question added!",
			});
		}
		resetForm();
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>
					{t("questionsTitle", { count: questions.length })}
				</CardTitle>
				<Button
					size="sm"
					onClick={() => {
						resetForm();
						setShowForm(!showForm);
					}}
				>
					<Plus className="h-4 w-4 mr-1" /> {t("addQuestion")}
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{showForm && (
					<form
						onSubmit={handleSubmit}
						className="border rounded-lg p-4 space-y-3"
					>
						<div className="space-y-1">
							<Label>Question</Label>
							<Input
								value={form.question}
								onChange={(e) => setForm({ ...form, question: e.target.value })}
								required
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1">
								<Label>Type</Label>
								<Select
									value={form.type}
									onValueChange={(v) =>
										setForm({ ...form, type: v as PollQuestionInput["type"] })
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="single">Single Choice</SelectItem>
										<SelectItem value="multiple">Multiple Choice</SelectItem>
										<SelectItem value="text">Free Text</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
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
						<div className="space-y-1">
							<Label>Options (one per line)</Label>
							<textarea
								className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[80px]"
								value={form.options}
								onChange={(e) => setForm({ ...form, options: e.target.value })}
								placeholder={"Option A\nOption B\nOption C"}
							/>
						</div>
						<div className="flex gap-2 justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={resetForm}
							>
								Cancel
							</Button>
							<Button type="submit" size="sm" disabled={isPending}>
								{editingId ? "Update" : "Add"}
							</Button>
						</div>
					</form>
				)}

				{questions.length === 0 && !showForm && (
					<div className="admin-empty">{t("noQuestions")}</div>
				)}

				<div className="space-y-2">
					{questions.map((q, i) => (
						<div
							key={q.id}
							className="flex items-start gap-3 border rounded-lg px-4 py-3"
						>
							<GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2 mb-1">
									<span className="text-xs text-muted-foreground">
										Q{i + 1}
									</span>
									<span className="text-xs bg-muted px-1.5 py-0.5 rounded">
										{q.type}
									</span>
								</div>
								<p className="text-sm font-medium">{q.question}</p>
								{q.options && (
									<div className="mt-1 text-xs text-muted-foreground">
										{q.options
											.split("\n")
											.filter(Boolean)
											.map((opt) => (
												<span
													key={opt}
													className="inline-block mr-2 bg-muted px-1.5 py-0.5 rounded mb-1"
												>
													{opt}
												</span>
											))}
									</div>
								)}
							</div>
							<div className="flex gap-1 shrink-0">
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									onClick={() => handleEdit(q)}
								>
									<Pencil className="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									onClick={() =>
										run(() => deletePollQuestion({ id: q.id }), {
											successMessage: "Question deleted",
										})
									}
								>
									<Trash2 className="h-3.5 w-3.5 text-destructive" />
								</Button>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
