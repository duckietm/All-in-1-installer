"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-fetch";

interface Configuration {
	provider: string;
	enabled: boolean;
	remote: string;
	branch: string;
	username: string;
	hasToken: boolean;
}
export function CatalogGitConfiguration({ onSaved }: { onSaved: () => void }) {
	const t = useTranslations("admin.studio.sync");
	const [config, setConfig] = useState<Configuration | null>(null),
		[token, setToken] = useState(""),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[message, setMessage] = useState("");
	useEffect(() => {
		const abort = new AbortController();
		void (async () => {
			try {
				const res = await adminFetch("/api/admin/catalog-export/config", {
					signal: abort.signal,
					cache: "no-store",
				});
				if (!res.ok) throw new Error(t("loadFailed"));
				const data = await res.json();
				if (!abort.signal.aborted) setConfig(data);
			} catch (error) {
				if (!abort.signal.aborted) setError((error as Error).message);
			}
		})();
		return () => abort.abort();
	}, [t]);
	async function submit(action: "save" | "test") {
		if (!config || busy) return;
		setBusy(true);
		setError("");
		setMessage("");
		try {
			const res = await adminFetch("/api/admin/catalog-export/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...config, token, action }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || t("requestFailed"));
			if (action === "save") {
				setConfig(data);
				setToken("");
				setMessage(t("saved"));
				onSaved();
			} else setMessage(data.message);
		} catch (error) {
			setError((error as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<details
			className="rounded-lg border border-[var(--admin-border)] p-3"
			open
		>
			<summary className="cursor-pointer font-semibold">
				{t("gitTitle")}
			</summary>
			<p className="my-3 text-sm text-[var(--admin-text-muted)]">
				{t("gitIntro")}
			</p>
			{config && (
				<fieldset disabled={busy} className="space-y-3">
					<p className="text-sm">
						{t("providerLabel")} <strong>{t("providerValue")}</strong>
					</p>
					<label htmlFor="catalog-git-1" className="block text-sm">
						{t("repositoryUrl")}
						<Input
							id="catalog-git-1"
							type="url"
							value={config.remote}
							onChange={(event) =>
								setConfig({ ...config, remote: event.target.value })
							}
						/>
					</label>
					<div className="grid gap-3 sm:grid-cols-2">
						<label htmlFor="catalog-git-2" className="block text-sm">
							{t("branch")}
							<Input
								id="catalog-git-2"
								value={config.branch}
								onChange={(event) =>
									setConfig({ ...config, branch: event.target.value })
								}
							/>
						</label>
						<label htmlFor="catalog-git-3" className="block text-sm">
							{t("username")}
							<Input
								id="catalog-git-3"
								autoComplete="off"
								value={config.username}
								onChange={(event) =>
									setConfig({ ...config, username: event.target.value })
								}
							/>
						</label>
					</div>
					<label htmlFor="catalog-git-4" className="block text-sm">
						{t("accessToken")}
						<Input
							id="catalog-git-4"
							type="password"
							autoComplete="new-password"
							value={token}
							placeholder={config.hasToken ? t("tokenSaved") : t("tokenEnter")}
							onChange={(event) => setToken(event.target.value)}
						/>
					</label>
					<p className="text-xs text-[var(--admin-text-muted)]">
						{t("tokenNote")}
					</p>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={config.enabled}
							onChange={(event) =>
								setConfig({ ...config, enabled: event.target.checked })
							}
						/>
						{t("autoExport")}
					</label>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => void submit("test")}>
							{t("testConnection")}
						</Button>
						<Button onClick={() => void submit("save")}>
							{busy ? t("working") : t("saveSettings")}
						</Button>
					</div>
				</fieldset>
			)}
			{error && (
				<p role="alert" className="mt-3 text-sm text-[var(--admin-warning)]">
					{error}
				</p>
			)}
			{message && (
				<p role="status" className="mt-3 text-sm">
					{message}
				</p>
			)}
		</details>
	);
}
