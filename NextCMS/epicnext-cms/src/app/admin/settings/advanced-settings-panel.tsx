"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	createSetting,
	deleteSetting,
	updateSetting,
} from "@/actions/admin-settings";
import { SearchInput } from "@/components/admin/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MANAGED_SETTING_KEYS } from "./cms-settings-config";

interface SettingRow {
	key: string;
	/** Masked for secrets — the real value never reaches the client. */
	value: string;
	comment: string | null;
	secret?: boolean;
}

export function AdvancedSettingsPanel({
	settings,
	canEdit,
}: {
	settings: SettingRow[];
	canEdit: boolean;
}) {
	const [query, setQuery] = useState("");
	const [showManaged, setShowManaged] = useState(false);
	const managed = useMemo(() => new Set(MANAGED_SETTING_KEYS), []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return settings.filter((s) => {
			if (!showManaged && managed.has(s.key)) return false;
			if (!q) return true;
			return (
				s.key.toLowerCase().includes(q) ||
				s.value.toLowerCase().includes(q) ||
				(s.comment ?? "").toLowerCase().includes(q)
			);
		});
	}, [settings, query, showManaged, managed]);

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="m-0 text-base font-bold text-[var(--admin-text)]">
						Advanced key / value
					</h2>
					<p className="m-0 mt-0.5 text-xs text-[var(--admin-text-muted)]">
						Raw website_settings rows. Prefer the grouped form above for common
						keys.
					</p>
				</div>
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					<input
						type="checkbox"
						checked={showManaged}
						onChange={(e) => setShowManaged(e.target.checked)}
						className="rounded border"
					/>
					Show keys already in the form
				</label>
			</div>

			<SearchInput
				value={query}
				onChange={setQuery}
				placeholder="Search keys, values, comments…"
			/>

			{canEdit ? (
				<form
					action={createSetting}
					className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto]"
				>
					<Input name="key" placeholder="key" required />
					<Input name="value" placeholder="value" />
					<Input name="comment" placeholder="comment (optional)" />
					<Button type="submit">Add / overwrite</Button>
				</form>
			) : null}

			{filtered.length === 0 ? (
				<div className="admin-empty">No matching settings</div>
			) : (
				<div className="space-y-2">
					{filtered.map((s) => (
						<div
							key={s.key}
							className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
						>
							<div className="flex flex-wrap items-center gap-2">
								<strong className="text-sm font-mono min-w-[12rem]">
									{s.key}
								</strong>
								{canEdit ? (
									<>
										<form
											action={updateSetting}
											className="flex flex-1 min-w-[220px] gap-2"
										>
											<input type="hidden" name="key" value={s.key} />
											<Input
												name="value"
												defaultValue={s.value}
												className="flex-1 font-mono text-xs"
											/>
											<Button type="submit" variant="outline" size="sm">
												Save
											</Button>
										</form>
										<form action={deleteSetting}>
											<input type="hidden" name="key" value={s.key} />
											<Button
												type="submit"
												variant="destructive"
												size="icon"
												aria-label={`Delete ${s.key}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</form>
									</>
								) : (
									<code className="flex-1 text-xs break-all text-muted-foreground">
										{s.secret ? "•• hidden ••" : s.value}
									</code>
								)}
							</div>
							{s.comment ? (
								<p className="m-0 mt-1.5 text-xs text-muted-foreground">
									{s.comment}
								</p>
							) : null}
						</div>
					))}
				</div>
			)}
		</section>
	);
}
