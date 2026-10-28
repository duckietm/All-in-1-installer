"use client";

import { useState } from "react";
import { renameCustomTheme } from "@/actions/admin-theme";

export function RenameTheme({ id, name }: { id: string; name: string }) {
	const [editing, setEditing] = useState(false);
	const [val, setVal] = useState(name);

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => setEditing(true)}
				className="text-xs font-medium text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)] no-underline"
			>
				Rename
			</button>
		);
	}

	return (
		<form action={renameCustomTheme} className="flex items-center gap-1">
			<input type="hidden" name="id" value={id} />
			<input
				name="name"
				value={val}
				onChange={(e) => setVal(e.target.value)}
				className="w-28 px-1.5 py-0.5 rounded-md border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-xs"
				style={{ borderColor: "var(--admin-border)" }}
			/>
			<button
				type="submit"
				className="text-xs font-semibold text-[var(--admin-accent)]"
			>
				OK
			</button>
			<button
				type="button"
				onClick={() => setEditing(false)}
				className="text-xs text-[var(--admin-text-muted)]"
			>
				✕
			</button>
		</form>
	);
}
