"use client";

import { useState } from "react";
import { createScope } from "@/actions/theme-builder";
import { Button } from "@/components/ui/button";

const SCOPE_TYPES = [
	{
		value: "global",
		label: "Global",
		desc: "Default theme for the entire site",
	},
	{ value: "site", label: "Site", desc: "Theme for a specific domain" },
	{
		value: "module",
		label: "Module",
		desc: "Theme for a feature section (shop, guilds, etc.)",
	},
	{ value: "route", label: "Route", desc: "Theme for a specific page path" },
] as const;

export function ScopeForm({
	moduleIds,
	scopeCount,
}: {
	moduleIds: string[];
	scopeCount: number;
}) {
	const [type, setType] = useState<string>("module");
	const [expanded, setExpanded] = useState(false);

	if (!expanded) {
		return (
			<Button
				type="button"
				variant="outline"
				className="w-full"
				onClick={() => setExpanded(true)}
			>
				+ Add Scope
			</Button>
		);
	}

	return (
		<div className="admin-card p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-sm font-semibold text-[var(--admin-text)]">
					New Scope
				</h3>
				<button
					type="button"
					onClick={() => setExpanded(false)}
					className="text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] text-xs"
				>
					Cancel
				</button>
			</div>

			<form action={createScope} className="space-y-3">
				<div>
					<label
						htmlFor="scope-name"
						className="block text-xs text-[var(--admin-text-muted)] mb-1"
					>
						Name
					</label>
					<input
						id="scope-name"
						type="text"
						name="name"
						required
						placeholder="e.g. Login Page"
						className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
						style={{ borderColor: "var(--admin-border)" }}
					/>
				</div>

				<div>
					<label
						htmlFor="scope-type"
						className="block text-xs text-[var(--admin-text-muted)] mb-1"
					>
						Type
					</label>
					<select
						id="scope-type"
						name="type"
						value={type}
						onChange={(e) => setType(e.target.value)}
						className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
						style={{ borderColor: "var(--admin-border)" }}
					>
						{SCOPE_TYPES.map((st) => (
							<option key={st.value} value={st.value}>
								{st.label} — {st.desc}
							</option>
						))}
					</select>
				</div>

				{type === "site" ? (
					<div>
						<label
							htmlFor="scope-domain"
							className="block text-xs text-[var(--admin-text-muted)] mb-1"
						>
							Domain
						</label>
						<input
							id="scope-domain"
							type="text"
							name="site_domain"
							required
							placeholder="e.g. hotel.example.com"
							className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
							style={{ borderColor: "var(--admin-border)" }}
						/>
					</div>
				) : null}

				{type === "module" ? (
					<div>
						<label
							htmlFor="scope-module"
							className="block text-xs text-[var(--admin-text-muted)] mb-1"
						>
							Module
						</label>
						<select
							id="scope-module"
							name="module_id"
							required
							className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
							style={{ borderColor: "var(--admin-border)" }}
						>
							<option value="">Select module...</option>
							{moduleIds.map((id) => (
								<option key={id} value={id}>
									{id}
								</option>
							))}
						</select>
					</div>
				) : null}

				{type === "route" ? (
					<div>
						<label
							htmlFor="scope-route"
							className="block text-xs text-[var(--admin-text-muted)] mb-1"
						>
							Route Path
						</label>
						<input
							id="scope-route"
							type="text"
							name="route_path"
							required
							placeholder="e.g. /login"
							className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
							style={{ borderColor: "var(--admin-border)" }}
						/>
					</div>
				) : null}

				{type !== "global" && scopeCount > 0 ? (
					<div>
						<label
							htmlFor="scope-parent"
							className="block text-xs text-[var(--admin-text-muted)] mb-1"
						>
							Parent Scope
						</label>
						<select
							id="scope-parent"
							name="parent_id"
							className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
							style={{ borderColor: "var(--admin-border)" }}
						>
							<option value="">None (inherits from global)</option>
						</select>
					</div>
				) : null}

				<Button type="submit" variant="default" className="w-full">
					Create Scope
				</Button>
			</form>
		</div>
	);
}
