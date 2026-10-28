"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	alertUser,
	disconnectUser,
	executeCommand,
	forwardUser,
	giveBadge,
	giveCredits,
	giveDiamonds,
	giveDuckets,
	hotelAlert,
	sendGift,
	setMotto,
	setRank,
	updateCatalog,
	updateNavigator,
	updateWordFilter,
} from "@/actions/commandocentrum";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";

const RCON_ERROR = "RCON command failed. Is the emulator running?";

export function CommandocentrumControls() {
	const t = useTranslations("pages.admin.commandocentrum");
	const { run, isPending } = useServerAction();

	const [category, setCategory] = useState("hotel");
	const [hotelMessage, setHotelMessage] = useState("");
	const [disconnect, setDisconnect] = useState({ userId: "", username: "" });
	const [alert, setAlert] = useState({ userId: "", message: "" });
	const [forward, setForward] = useState({ userId: "", roomId: "" });
	const [credits, setCredits] = useState({ userId: "", credits: "" });
	const [duckets, setDuckets] = useState({ userId: "", amount: "" });
	const [diamonds, setDiamonds] = useState({ userId: "", amount: "" });
	const [badge, setBadge] = useState({ userId: "", badge: "" });
	const [motto, setMottoForm] = useState({ userId: "", motto: "" });
	const [rank, setRankForm] = useState({ userId: "", rank: "" });
	const [command, setCommand] = useState({ userId: "", command: "" });
	const [gift, setGift] = useState({
		userId: "",
		itemId: "",
		message: t("defaultGiftMessage"),
	});

	return (
		<section id="commands" className="my-6 scroll-mt-4 space-y-4">
			<h2 className="admin-section-title">{t("emulatorControls")}</h2>
			<fieldset
				className="flex flex-wrap gap-2"
				aria-label={t("commandCategories")}
			>
				{["hotel", "players", "rewards", "advanced"].map((group) => (
					<Button
						key={group}
						type="button"
						variant={category === group ? "default" : "outline"}
						aria-pressed={category === group}
						disabled={isPending}
						onClick={() => setCategory(group)}
					>
						{t(`groups.${group}`)}
					</Button>
				))}
			</fieldset>
			<p className="text-sm text-[var(--admin-text-muted)]" role="status">
				{isPending ? t("executing") : t("chooseCommand")}
			</p>
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
				{category === "hotel" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("updateCatalog")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-4">
							{t("updateCatalogDesc")}
						</p>
						<Button
							type="button"
							variant="default"
							disabled={isPending}
							onClick={() =>
								run(() => updateCatalog(), {
									successMessage: "Catalog updated.",
									errorMessage: RCON_ERROR,
								})
							}
						>
							{t("updateCatalog")}
						</Button>
					</div>
				)}
				{category === "hotel" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("updateWordFilter")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-4">
							{t("updateWordFilterDesc")}
						</p>
						<Button
							type="button"
							variant="default"
							disabled={isPending}
							onClick={() =>
								run(() => updateWordFilter(), {
									successMessage: "Word filter updated.",
									errorMessage: RCON_ERROR,
								})
							}
						>
							{t("updateWordFilter")}
						</Button>
					</div>
				)}
				{category === "hotel" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("updateNavigator")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-4">
							{t("updateNavigatorDesc")}
						</p>
						<Button
							type="button"
							variant="default"
							disabled={isPending}
							onClick={() =>
								run(() => updateNavigator(), {
									successMessage: "Navigator updated.",
									errorMessage: RCON_ERROR,
								})
							}
						>
							{t("updateNavigator")}
						</Button>
					</div>
				)}
				{category === "hotel" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("hotelAlert")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("hotelAlertDesc")}
						</p>
						<div className="flex flex-wrap gap-2">
							<input
								value={hotelMessage}
								onChange={(e) => setHotelMessage(e.target.value)}
								required
								maxLength={512}
								aria-label={t("messageToBroadcast")}
								placeholder={t("messageToBroadcast")}
								className="flex-1 min-w-0 w-full sm:w-auto"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="destructive"
								disabled={isPending || !hotelMessage.trim()}
								onClick={() =>
									run(() => hotelAlert({ message: hotelMessage }), {
										successMessage: "Hotel alert sent.",
										errorMessage: RCON_ERROR,
										onSuccess: () => setHotelMessage(""),
									})
								}
							>
								{t("sendAlert")}
							</Button>
						</div>
					</div>
				)}
				{category === "players" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("actions.disconnect")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("disconnectDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={disconnect.userId}
								onChange={(e) =>
									setDisconnect((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("usernameRequired")}
								placeholder={t("usernameRequired")}
								value={disconnect.username}
								onChange={(e) =>
									setDisconnect((s) => ({ ...s, username: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="destructive"
								className="w-full"
								disabled={
									isPending || !disconnect.userId || !disconnect.username.trim()
								}
								onClick={() =>
									run(
										() =>
											disconnectUser({
												userId: Number(disconnect.userId),
												username: disconnect.username,
											}),
										{
											successMessage: "User disconnected.",
											errorMessage: RCON_ERROR,
											onSuccess: () =>
												setDisconnect({ userId: "", username: "" }),
										},
									)
								}
							>
								{t("actions.disconnect")}
							</Button>
						</div>
					</div>
				)}
				{category === "players" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("actions.alert")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("alertDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={alert.userId}
								onChange={(e) =>
									setAlert((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("alertMessage")}
								placeholder={t("alertMessage")}
								value={alert.message}
								onChange={(e) =>
									setAlert((s) => ({ ...s, message: e.target.value }))
								}
								maxLength={512}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !alert.userId || !alert.message.trim()}
								onClick={() =>
									run(
										() =>
											alertUser({
												userId: Number(alert.userId),
												message: alert.message,
											}),
										{
											successMessage: "Alert sent.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setAlert({ userId: "", message: "" }),
										},
									)
								}
							>
								{t("actions.alert")}
							</Button>
						</div>
					</div>
				)}
				{category === "players" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("forwardToRoom")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("forwardDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={forward.userId}
								onChange={(e) =>
									setForward((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={1}
								aria-label={t("roomId")}
								placeholder={t("roomId")}
								value={forward.roomId}
								onChange={(e) =>
									setForward((s) => ({ ...s, roomId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !forward.userId || !forward.roomId}
								onClick={() =>
									run(
										() =>
											forwardUser({
												userId: Number(forward.userId),
												roomId: Number(forward.roomId),
											}),
										{
											successMessage: "User forwarded.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setForward({ userId: "", roomId: "" }),
										},
									)
								}
							>
								{t("forwardUser")}
							</Button>
						</div>
					</div>
				)}
				{category === "rewards" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("giveCredits")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("giveCreditsDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={credits.userId}
								onChange={(e) =>
									setCredits((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={1}
								aria-label={t("amount")}
								placeholder={t("amount")}
								value={credits.credits}
								onChange={(e) =>
									setCredits((s) => ({ ...s, credits: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !credits.userId || !credits.credits}
								onClick={() =>
									run(
										() =>
											giveCredits({
												userId: Number(credits.userId),
												credits: Number(credits.credits),
											}),
										{
											successMessage: "Credits sent.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setCredits({ userId: "", credits: "" }),
										},
									)
								}
							>
								{t("giveCredits")}
							</Button>
						</div>
					</div>
				)}
				{category === "rewards" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("giveDuckets")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("giveDucketsDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={duckets.userId}
								onChange={(e) =>
									setDuckets((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={1}
								aria-label={t("amount")}
								placeholder={t("amount")}
								value={duckets.amount}
								onChange={(e) =>
									setDuckets((s) => ({ ...s, amount: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !duckets.userId || !duckets.amount}
								onClick={() =>
									run(
										() =>
											giveDuckets({
												userId: Number(duckets.userId),
												amount: Number(duckets.amount),
											}),
										{
											successMessage: "Duckets sent.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setDuckets({ userId: "", amount: "" }),
										},
									)
								}
							>
								{t("giveDuckets")}
							</Button>
						</div>
					</div>
				)}
				{category === "rewards" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("giveDiamonds")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("giveDiamondsDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={diamonds.userId}
								onChange={(e) =>
									setDiamonds((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={1}
								aria-label={t("amount")}
								placeholder={t("amount")}
								value={diamonds.amount}
								onChange={(e) =>
									setDiamonds((s) => ({ ...s, amount: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !diamonds.userId || !diamonds.amount}
								onClick={() =>
									run(
										() =>
											giveDiamonds({
												userId: Number(diamonds.userId),
												amount: Number(diamonds.amount),
											}),
										{
											successMessage: "Diamonds sent.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setDiamonds({ userId: "", amount: "" }),
										},
									)
								}
							>
								{t("giveDiamonds")}
							</Button>
						</div>
					</div>
				)}
				{category === "rewards" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("giveBadge")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("giveBadgeDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={badge.userId}
								onChange={(e) =>
									setBadge((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("badgeCode")}
								placeholder={t("badgeCode")}
								value={badge.badge}
								onChange={(e) =>
									setBadge((s) => ({ ...s, badge: e.target.value }))
								}
								maxLength={32}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !badge.userId || !badge.badge.trim()}
								onClick={() =>
									run(
										() =>
											giveBadge({
												userId: Number(badge.userId),
												badge: badge.badge,
											}),
										{
											successMessage: "Badge granted.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setBadge({ userId: "", badge: "" }),
										},
									)
								}
							>
								{t("giveBadge")}
							</Button>
						</div>
					</div>
				)}
				{category === "players" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("setMotto")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("setMottoDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={motto.userId}
								onChange={(e) =>
									setMottoForm((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("newMotto")}
								placeholder={t("newMotto")}
								value={motto.motto}
								onChange={(e) =>
									setMottoForm((s) => ({ ...s, motto: e.target.value }))
								}
								maxLength={127}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !motto.userId || !motto.motto.trim()}
								onClick={() =>
									run(
										() =>
											setMotto({
												userId: Number(motto.userId),
												motto: motto.motto,
											}),
										{
											successMessage: "Motto updated.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setMottoForm({ userId: "", motto: "" }),
										},
									)
								}
							>
								{t("setMotto")}
							</Button>
						</div>
					</div>
				)}
				{category === "players" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("setRank")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("setRankDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={rank.userId}
								onChange={(e) =>
									setRankForm((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={0}
								max={10}
								aria-label={t("rankPlaceholder")}
								placeholder={t("rankPlaceholder")}
								value={rank.rank}
								onChange={(e) =>
									setRankForm((s) => ({ ...s, rank: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !rank.userId || rank.rank === ""}
								onClick={() =>
									run(
										() =>
											setRank({
												userId: Number(rank.userId),
												rank: Number(rank.rank),
											}),
										{
											successMessage: "Rank updated.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setRankForm({ userId: "", rank: "" }),
										},
									)
								}
							>
								{t("setRank")}
							</Button>
						</div>
					</div>
				)}
				{category === "advanced" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("executeCommand")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("executeCommandDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={command.userId}
								onChange={(e) =>
									setCommand((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("commandPlaceholder")}
								placeholder={t("commandPlaceholder")}
								value={command.command}
								onChange={(e) =>
									setCommand((s) => ({ ...s, command: e.target.value }))
								}
								maxLength={100}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={
									isPending || !command.userId || !command.command.trim()
								}
								onClick={() =>
									run(
										() =>
											executeCommand({
												userId: Number(command.userId),
												command: command.command,
											}),
										{
											successMessage: "Command executed.",
											errorMessage: RCON_ERROR,
											onSuccess: () => setCommand({ userId: "", command: "" }),
										},
									)
								}
							>
								{t("execute")}
							</Button>
						</div>
					</div>
				)}
				{category === "rewards" && (
					<div className="admin-card">
						<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
							{t("sendGift")}
						</h3>
						<p className="text-xs text-[var(--admin-text-muted)] mb-3">
							{t("sendGiftDesc")}
						</p>
						<div className="space-y-2">
							<input
								type="number"
								min={1}
								aria-label={t("userId")}
								placeholder={t("userId")}
								value={gift.userId}
								onChange={(e) =>
									setGift((s) => ({ ...s, userId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="number"
								min={1}
								aria-label={t("furniId")}
								placeholder={t("furniId")}
								value={gift.itemId}
								onChange={(e) =>
									setGift((s) => ({ ...s, itemId: e.target.value }))
								}
								className="w-full"
								disabled={isPending}
							/>
							<input
								type="text"
								aria-label={t("giftMessage")}
								placeholder={t("giftMessage")}
								value={gift.message}
								onChange={(e) =>
									setGift((s) => ({ ...s, message: e.target.value }))
								}
								maxLength={255}
								className="w-full"
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="default"
								className="w-full"
								disabled={isPending || !gift.userId || !gift.itemId}
								onClick={() =>
									run(
										() =>
											sendGift({
												userId: Number(gift.userId),
												itemId: Number(gift.itemId),
												message: gift.message,
											}),
										{
											successMessage: "Gift sent.",
											errorMessage: RCON_ERROR,
											onSuccess: () =>
												setGift({
													userId: "",
													itemId: "",
													message: t("defaultGiftMessage"),
												}),
										},
									)
								}
							>
								{t("sendGift")}
							</Button>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
