"use client";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { createPoll, updatePoll } from "@/actions/polls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import type { CreatePollInput, UpdatePollInput } from "@/lib/validators/poll";

interface PollFormProps {
	defaultValues?: Partial<CreatePollInput> & { id?: number };
}

interface PollFormValues {
	title: string;
	description: string | null;
	status: string;
	showResults: number;
	multipleChoice: number;
	startsAt?: Date | null;
	endsAt?: Date | null;
}

export function PollForm({ defaultValues }: PollFormProps) {
	const t = useTranslations("pages.admin.polls");
	const { run, isPending } = useServerAction();
	const isEditing = !!defaultValues?.id;

	const form = useForm<PollFormValues>({
		defaultValues: {
			title: "",
			description: "",
			status: "draft",
			showResults: 1,
			multipleChoice: 0,
			...defaultValues,
		},
	});

	function onSubmit(data: PollFormValues) {
		if (isEditing) {
			run(
				() =>
					updatePoll({ id: defaultValues.id, ...data } as UpdatePollInput & {
						id: number;
					}),
				{
					successMessage: t("toastUpdated"),
				},
			);
		} else {
			run(() => createPoll(data as CreatePollInput), {
				successMessage: t("toastCreated"),
				onSuccess: (result) => {
					const data = result.data as Record<string, unknown> | undefined;
					if (data?.id) {
						window.location.href = `/admin/polls/${data.id}`;
					}
				},
			});
		}
	}

	return (
		<form onSubmit={form.handleSubmit(onSubmit)}>
			<Card>
				<CardHeader>
					<CardTitle>
						{isEditing ? t("formEditTitle") : t("formDetailsTitle")}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="title">{t("formTitle")}</Label>
						<Input id="title" {...form.register("title")} />
						{form.formState.errors.title && (
							<p className="text-sm text-destructive">
								{form.formState.errors.title.message}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">{t("formDescription")}</Label>
						<Textarea
							id="description"
							rows={3}
							{...form.register("description")}
						/>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div className="space-y-2">
							<Label htmlFor="status">{t("colStatus")}</Label>
							<Select
								value={form.watch("status")}
								onValueChange={(v) =>
									form.setValue("status", v as CreatePollInput["status"])
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="draft">{t("statusDraft")}</SelectItem>
									<SelectItem value="active">{t("statusActive")}</SelectItem>
									<SelectItem value="closed">{t("statusClosed")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label>{t("formStartsAt")}</Label>
							<DateTimePicker
								value={form.watch("startsAt")}
								onChange={(d) =>
									form.setValue("startsAt", d, { shouldDirty: true })
								}
								placeholder={t("formSelectStart")}
							/>
						</div>
						<div className="space-y-2">
							<Label>{t("formEndsAt")}</Label>
							<DateTimePicker
								value={form.watch("endsAt")}
								onChange={(d) =>
									form.setValue("endsAt", d, { shouldDirty: true })
								}
								placeholder={t("formSelectEnd")}
							/>
						</div>
					</div>

					<div className="flex gap-6">
						<div className="flex items-center gap-2">
							<Switch
								id="poll-show-results"
								checked={form.watch("showResults") === 1}
								onCheckedChange={(v) => form.setValue("showResults", v ? 1 : 0)}
							/>
							<Label htmlFor="poll-show-results">{t("formShowResults")}</Label>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								id="poll-multiple-choice"
								checked={form.watch("multipleChoice") === 1}
								onCheckedChange={(v) =>
									form.setValue("multipleChoice", v ? 1 : 0)
								}
							/>
							<Label htmlFor="poll-multiple-choice">
								{t("formAllowMultiple")}
							</Label>
						</div>
					</div>

					<div className="flex justify-end">
						<Button type="submit" disabled={isPending}>
							{isPending
								? t("formSaving")
								: isEditing
									? t("formUpdate")
									: t("formCreate")}
						</Button>
					</div>
				</CardContent>
			</Card>
		</form>
	);
}
