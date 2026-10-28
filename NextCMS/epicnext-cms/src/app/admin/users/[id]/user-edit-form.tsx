"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { updateUser } from "@/actions/users";
import { useFormErrorFocus } from "@/components/admin/form-feedback";
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
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { type UpdateUserInput, updateUserSchema } from "@/lib/validators/user";

interface UserEditFormProps {
	user: {
		id: number;
		username: string;
		mail: string;
		rank: number;
		motto: string;
		credits: number;
		pixels: number;
		diamonds: number;
		duckets: number;
	};
	/** Ranks loaded from the `permissions` table (id + human-readable name). */
	ranks?: Array<{ id: number; name: string }>;
}

// Fallback used if the page does not supply the DB-loaded rank list.
const FALLBACK_RANKS: Array<{ id: number; name: string }> = [
	{ id: 1, name: "User" },
	{ id: 2, name: "Bronze" },
	{ id: 3, name: "Silver" },
	{ id: 4, name: "Gold" },
	{ id: 5, name: "Moderator" },
	{ id: 6, name: "Admin" },
	{ id: 7, name: "Super Admin" },
];

export function UserEditForm({ user, ranks }: UserEditFormProps) {
	const rankOptions = ranks && ranks.length > 0 ? ranks : FALLBACK_RANKS;
	const formRef = useRef<HTMLFormElement>(null);
	const tAction = useTranslations("pages.admin.actions");
	const router = useRouter();
	const { isPending, run, fieldErrors } = useServerAction();

	const {
		register,
		handleSubmit,
		setValue,
		setError,
		reset,
		formState: { errors, isDirty },
	} = useForm<UpdateUserInput>({
		resolver: zodResolver(updateUserSchema),
		defaultValues: {
			username: user.username,
			mail: user.mail,
			rank: user.rank,
			motto: user.motto,
			credits: user.credits,
			pixels: user.pixels,
			diamonds: user.diamonds,
			duckets: user.duckets,
		},
	});

	useUnsavedChanges(isDirty, tAction("leaveUnsaved"));
	useFormErrorFocus(formRef, fieldErrors, isPending);
	useEffect(() => {
		for (const [field, messages] of Object.entries(fieldErrors)) {
			if (
				[
					"username",
					"mail",
					"rank",
					"motto",
					"credits",
					"pixels",
					"diamonds",
					"duckets",
				].includes(field)
			)
				setError(
					field as keyof UpdateUserInput,
					{ type: "server", message: messages.join(" · ") },
					{ shouldFocus: true },
				);
		}
	}, [fieldErrors, setError]);
	function onSubmit(data: UpdateUserInput) {
		run(() => updateUser({ id: user.id, ...data }), {
			successMessage: tAction("saved"),
			onSuccess: () => {
				reset(data);
				router.refresh();
			},
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Edit User</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					ref={formRef}
					onSubmit={handleSubmit(onSubmit)}
					className="space-y-4"
				>
					<fieldset disabled={isPending} className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="username">Username</Label>
								<Input id="username" {...register("username")} />
								{errors.username && (
									<p className="text-sm text-destructive">
										{errors.username.message}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="mail">Email</Label>
								<Input id="mail" type="email" {...register("mail")} />
								{errors.mail && (
									<p className="text-sm text-destructive">
										{errors.mail.message}
									</p>
								)}
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="rank">Rank</Label>
								<Select
									defaultValue={String(user.rank)}
									onValueChange={(v) =>
										setValue("rank", parseInt(v, 10), {
											shouldDirty: true,
											shouldValidate: true,
										})
									}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select rank" />
									</SelectTrigger>
									<SelectContent>
										{rankOptions.map((r) => (
											<SelectItem key={r.id} value={String(r.id)}>
												{r.id} — {r.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="motto">Motto</Label>
								<Input id="motto" {...register("motto")} />
								{errors.motto && (
									<p role="alert" className="text-sm text-destructive">
										{errors.motto.message}
									</p>
								)}
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div className="space-y-2">
								<Label htmlFor="credits">Credits</Label>
								<Input
									id="credits"
									type="number"
									{...register("credits", { valueAsNumber: true })}
								/>
								{errors.credits && (
									<p role="alert" className="text-sm text-destructive">
										{errors.credits.message}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="pixels">Pixels</Label>
								<Input
									id="pixels"
									type="number"
									{...register("pixels", { valueAsNumber: true })}
								/>
								{errors.pixels && (
									<p role="alert" className="text-sm text-destructive">
										{errors.pixels.message}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="diamonds">Diamonds</Label>
								<Input
									id="diamonds"
									type="number"
									{...register("diamonds", { valueAsNumber: true })}
								/>
								{errors.diamonds && (
									<p role="alert" className="text-sm text-destructive">
										{errors.diamonds.message}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="duckets">Duckets</Label>
								<Input
									id="duckets"
									type="number"
									{...register("duckets", { valueAsNumber: true })}
								/>
								{errors.duckets && (
									<p role="alert" className="text-sm text-destructive">
										{errors.duckets.message}
									</p>
								)}
							</div>
						</div>

						<Button type="submit" disabled={isPending}>
							{isPending ? "Saving..." : "Save Changes"}
						</Button>
					</fieldset>
				</form>
			</CardContent>
		</Card>
	);
}
