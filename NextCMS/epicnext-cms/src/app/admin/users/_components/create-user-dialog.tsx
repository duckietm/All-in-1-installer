"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { createUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
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

interface CreateUserDialogProps {
	sessionRank: number;
}

const RANK_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

export function CreateUserDialog({ sessionRank }: CreateUserDialogProps) {
	const t = useTranslations("pages.admin.users.create");
	const { run, isPending } = useServerAction();
	const [open, setOpen] = useState(false);
	const [username, setUsername] = useState("");
	const [mail, setMail] = useState("");
	const [password, setPassword] = useState("");
	const [rank, setRank] = useState("1");
	const [motto, setMotto] = useState("");

	const allowedRanks = RANK_OPTIONS.filter((r) =>
		sessionRank >= 7 ? true : r < sessionRank,
	);

	function reset() {
		setUsername("");
		setMail("");
		setPassword("");
		setRank("1");
		setMotto("");
	}

	function generatePassword() {
		const charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
		let out = "";
		const buf = new Uint32Array(12);
		crypto.getRandomValues(buf);
		for (let i = 0; i < buf.length; i++)
			out += charset[buf[i] % charset.length];
		setPassword(out);
		toast.message(t("passwordGenerated"));
	}

	function handleCreate() {
		const u = username.trim();
		const m = mail.trim();
		if (!u || !m || !password) {
			toast.error(t("required"));
			return;
		}
		if (u.length < 3 || u.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(u)) {
			toast.error(t("invalidUsername"));
			return;
		}
		if (password.length < 6) {
			toast.error(t("passwordLength"));
			return;
		}

		run(
			() =>
				createUser({
					username: u,
					mail: m,
					password,
					rank: Number(rank),
					motto: motto.trim(),
				}),
			{
				successMessage: t("created", { username: u }),
				onSuccess: () => {
					setOpen(false);
					reset();
				},
			},
		);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button>
					<UserPlus className="mr-2 h-4 w-4" />
					{t("newUser")}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription>{t("description")}</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="cu-username">{t("username")}</Label>
						<Input
							id="cu-username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							placeholder={t("usernamePlaceholder")}
							autoComplete="off"
							maxLength={20}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cu-mail">{t("email")}</Label>
						<Input
							id="cu-mail"
							type="email"
							value={mail}
							onChange={(e) => setMail(e.target.value)}
							placeholder="user@example.com"
							autoComplete="off"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cu-password">{t("password")}</Label>
						<div className="flex gap-2">
							<Input
								id="cu-password"
								type="text"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t("passwordPlaceholder")}
								autoComplete="new-password"
								className="font-mono"
							/>
							<Button
								type="button"
								variant="outline"
								onClick={generatePassword}
							>
								{t("generate")}
							</Button>
						</div>
					</div>
					<div className="space-y-2">
						<Label>{t("rank")}</Label>
						<Select value={rank} onValueChange={setRank}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{allowedRanks.map((r) => (
									<SelectItem key={r} value={String(r)}>
										{t("rankOption", { rank: r })}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cu-motto">{t("motto")}</Label>
						<Input
							id="cu-motto"
							value={motto}
							onChange={(e) => setMotto(e.target.value)}
							maxLength={127}
							placeholder={t("mottoPlaceholder")}
						/>
					</div>

					<Button
						onClick={handleCreate}
						disabled={isPending}
						className="w-full"
					>
						{isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<UserPlus className="mr-2 h-4 w-4" />
						)}
						{t("title")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
