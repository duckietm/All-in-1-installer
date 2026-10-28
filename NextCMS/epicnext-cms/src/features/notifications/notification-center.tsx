"use client";
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Category, NotificationFeed, Preferences } from "./service";

export function NotificationCenter({ userId }: { userId: number }) {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	return (
		<QueryClientProvider client={client}>
			<NotificationContent key={userId} userId={userId} />
		</QueryClientProvider>
	);
}

function NotificationContent({ userId }: { userId: number }) {
	const t = useTranslations("pages.notifications");
	const format = useFormatter();
	const [page, setPage] = useState(1);
	const client = useQueryClient();
	const queryKey = ["notifications", userId];
	const feed = useQuery<NotificationFeed>({
		queryKey: [...queryKey, page],
		queryFn: async ({ signal }) => {
			const response = await fetch(`/cms_api/notifications?page=${page}`, {
				cache: "no-store",
				signal,
			});
			if (!response.ok) throw new Error("Unavailable");
			return response.json();
		},
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
	const mutation = useMutation({
		mutationFn: async (
			body:
				| { action: "read"; key: string }
				| { action: "preferences"; preferences: Preferences },
		) => {
			const response = await fetch("/cms_api/notifications", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error("Unavailable");
		},
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey });
		},
	});
	const data = feed.data;
	return (
		<section className="page-grid" aria-label={t("title")}>
			<h1 className="text-2xl font-bold">{t("title")}</h1>
			<ContentCard icon="🔔" title={t("title")} subtitle={t("subtitle")}>
				<p className="muted">{t("scope")}</p>
			</ContentCard>
			{feed.isPending ? (
				<ContentCard>
					<p role="status">{t("loading")}</p>
				</ContentCard>
			) : null}
			{feed.isError ? (
				<ContentCard>
					<p role="alert">{t("error")}</p>
					<Button variant="outline" onClick={() => feed.refetch()}>
						{t("retry")}
					</Button>
				</ContentCard>
			) : null}
			{data ? (
				<>
					<ContentCard title={t("preferences")}>
						<fieldset
							disabled={mutation.isPending}
							className="flex flex-wrap gap-5"
						>
							<legend className="sr-only">{t("preferences")}</legend>
							{(["support", "friends", "events"] as Category[]).map(
								(category) => (
									<label
										key={category}
										htmlFor={`notification-${category}`}
										className="flex items-center gap-2"
									>
										<Checkbox
											id={`notification-${category}`}
											style={{
												borderColor: "var(--color-primary)",
												backgroundColor: data.preferences[category]
													? "var(--color-primary)"
													: "transparent",
												color: "var(--color-primary-foreground)",
											}}
											aria-label={t(category)}
											disabled={mutation.isPending}
											checked={data.preferences[category]}
											onCheckedChange={(checked) =>
												mutation.mutate({
													action: "preferences",
													preferences: {
														...data.preferences,
														[category]: checked,
													},
												})
											}
										/>
										{t(category)}
									</label>
								),
							)}
						</fieldset>
						<p className="muted mt-3">{t("preferencesHint")}</p>
					</ContentCard>
					<ContentCard title={t("unreadCount", { count: data.unread })}>
						{mutation.isError ? <p role="alert">{t("saveError")}</p> : null}
						{mutation.isSuccess ? (
							<p role="status" className="muted">
								{t("saved")}
							</p>
						) : null}
						{!data.items.length ? (
							<EmptyState>{t("empty")}</EmptyState>
						) : (
							<ul className="space-y-3">
								{data.items.map((item) => (
									<li
										key={item.key}
										className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-current/10 p-4"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm muted">
												{t(item.category)} · {t(item.read ? "read" : "unread")}
											</p>
											<Link
												href={item.href}
												className="font-semibold break-words underline"
											>
												{item.title}
											</Link>
											{item.occurredAt ? (
												<p className="text-sm muted">
													<time dateTime={item.occurredAt}>
														{format.dateTime(new Date(item.occurredAt), {
															dateStyle: "medium",
															timeStyle: "short",
														})}
													</time>
												</p>
											) : null}
										</div>
										{!item.read ? (
											<Button
												variant="outline"
												disabled={mutation.isPending}
												onClick={() =>
													mutation.mutate({ action: "read", key: item.key })
												}
											>
												{t("markRead")}
											</Button>
										) : null}
									</li>
								))}
							</ul>
						)}
						{data.pages > 1 ? (
							<nav
								aria-label={t("pagination")}
								className="mt-4 flex items-center gap-3"
							>
								<Button
									variant="outline"
									disabled={data.page <= 1}
									onClick={() => setPage(data.page - 1)}
								>
									{t("previous")}
								</Button>
								<span>{t("page", { page: data.page, pages: data.pages })}</span>
								<Button
									variant="outline"
									disabled={data.page >= data.pages}
									onClick={() => setPage(data.page + 1)}
								>
									{t("next")}
								</Button>
							</nav>
						) : null}
					</ContentCard>
				</>
			) : null}
		</section>
	);
}
