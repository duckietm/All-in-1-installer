"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createEvent, updateEvent } from "@/actions/events";
import { ArticlePreview } from "@/components/admin/article-preview";
import { PublicationPreflight } from "@/components/admin/publication-preflight";
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
import { Textarea } from "@/components/ui/textarea";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { useServerAction } from "@/hooks/use-server-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { publicationIssues } from "@/lib/publication-preflight";
import type {
	CreateEventInput,
	UpdateEventInput,
} from "@/lib/validators/event";

interface EventType {
	id: number;
	name: string;
	slug: string;
	color: string;
}

interface EventFormProps {
	userId?: string;
	eventTypes: EventType[];
	defaultValues?: Partial<CreateEventInput> & { id?: number };
}

interface EventFormValues {
	title: string;
	description: string;
	image?: string | null;
	maxPlayers?: string | number | null;
	roomId?: string | number | null;
	typeId: number;
	status: string;
	isRecurring: number;
	startsAt?: Date | null;
	endsAt?: Date | null;
}

export function EventForm({
	eventTypes,
	defaultValues,
	userId,
}: EventFormProps) {
	const t = useTranslations("pages.admin.events");
	const tAction = useTranslations("pages.admin.actions");
	const router = useRouter();
	const [preview, setPreview] = useState(false);
	const { run, isPending } = useServerAction();
	const isEditing = !!defaultValues?.id;

	const form = useForm<EventFormValues>({
		defaultValues: {
			title: "",
			description: "",
			typeId: eventTypes[0]?.id ?? 0,
			status: "draft",
			isRecurring: 0,
			...defaultValues,
		},
	});

	const dirty = form.formState.isDirty;
	useUnsavedChanges(dirty, tAction("leaveUnsaved"));
	const recovery = useFormRecovery({
		userId,
		kind: "event",
		record: String(defaultValues?.id ?? "new"),
		dirty,
		snapshot: () => JSON.parse(JSON.stringify(form.getValues())),
		restore: (payload) => {
			const restored = {
				...payload,
				startsAt: payload.startsAt ? new Date(String(payload.startsAt)) : null,
				endsAt: payload.endsAt ? new Date(String(payload.endsAt)) : null,
			} as EventFormValues;
			form.reset(restored, { keepDefaultValues: true });
		},
	});
	const values = form.watch();
	const issues = publicationIssues({ kind: "event", ...values });
	function onSubmit(data: EventFormValues) {
		if (isPending) return;
		recovery.flush();
		if (
			data.status === "published" &&
			publicationIssues({ kind: "event", ...data }).some(
				(issue) => issue.severity === "error",
			)
		)
			return;
		if (isEditing && defaultValues?.id) {
			run(
				() =>
					updateEvent({ id: defaultValues.id, ...data } as UpdateEventInput & {
						id: number;
					}),
				{
					successMessage: t("toastUpdated"),
					onSuccess: () => {
						recovery.clear();
						form.reset(data);
						router.refresh();
					},
				},
			);
		} else {
			run(() => createEvent(data as CreateEventInput), {
				successMessage: t("toastCreated"),
				onSuccess: (result) => {
					recovery.clear();
					form.reset(data);
					if (result.id) {
						router.push(`/admin/events/${result.id}`);
					}
				},
			});
		}
	}

	return (
		<form
			onChangeCapture={recovery.changed}
			onSubmit={form.handleSubmit(onSubmit)}
		>
			<fieldset disabled={isPending} className="contents">
				<Card>
					<CardHeader>
						<CardTitle>
							{isEditing ? t("formEditTitle") : t("formDetailsTitle")}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{recovery.panel}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
								<Label htmlFor="typeId">{t("formEventType")}</Label>
								<Select
									value={String(form.watch("typeId"))}
									onValueChange={(v) =>
										form.setValue("typeId", Number(v), { shouldDirty: true })
									}
								>
									<SelectTrigger>
										<SelectValue placeholder={t("formSelectType")} />
									</SelectTrigger>
									<SelectContent>
										{eventTypes.map((et) => (
											<SelectItem key={et.id} value={String(et.id)}>
												{et.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t("formDescription")}</Label>
							<Textarea
								id="description"
								rows={4}
								{...form.register("description")}
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
										form.setValue("endsAt", d ?? null, { shouldDirty: true })
									}
									placeholder={t("formSelectEnd")}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="maxPlayers">{t("formMaxPlayers")}</Label>
								<Input
									id="maxPlayers"
									type="number"
									{...form.register("maxPlayers")}
									placeholder={t("formUnlimited")}
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="roomId">{t("formRoomId")}</Label>
								<Input
									id="roomId"
									type="number"
									{...form.register("roomId")}
									placeholder={t("formOptional")}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="status">{t("colStatus")}</Label>
								<Select
									value={form.watch("status")}
									onValueChange={(v) =>
										form.setValue("status", v as CreateEventInput["status"], {
											shouldDirty: true,
										})
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="draft">{t("statusDraft")}</SelectItem>
										<SelectItem value="published">
											{t("statusPublished")}
										</SelectItem>
										<SelectItem value="cancelled">
											{t("statusCancelled")}
										</SelectItem>
										<SelectItem value="completed">
											{t("statusCompleted")}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="image">{t("formImageUrl")}</Label>
							<Input
								id="image"
								{...form.register("image")}
								placeholder="https://..."
							/>
						</div>

						<PublicationPreflight
							issues={issues}
							paths={[
								"/events",
								...(defaultValues?.id ? [`/events/${defaultValues.id}`] : []),
							]}
						/>
						<ArticlePreview
							title={tAction("preview")}
							data={
								preview
									? {
											title: values.title,
											image: values.image ?? "",
											summary: values.description,
											body: "",
										}
									: null
							}
							onClose={() => setPreview(false)}
						/>
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setPreview(true)}
							>
								{tAction("preview")}
							</Button>
							<Button
								type="submit"
								disabled={
									isPending ||
									(values.status === "published" &&
										issues.some((issue) => issue.severity === "error"))
								}
							>
								{isPending
									? t("formSaving")
									: isEditing
										? t("formUpdate")
										: t("formCreate")}
							</Button>
						</div>
					</CardContent>
				</Card>
			</fieldset>
		</form>
	);
}
