"use client";

import { Loader2, Music } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	getCachedSongPickerOptions,
	invalidateSongPickerCache,
	loadSongPickerOptions,
	type SoundtrackOption,
} from "@/lib/client-cache/song-picker-cache";

// Re-export so existing `import { invalidateSongPickerCache } from '.../song-picker'`
// callsites keep working. New code should import from the lib module directly.
export { invalidateSongPickerCache };

interface Props {
	value: number;
	onChange: (id: number) => void;
	disabled?: boolean;
}

function formatLength(seconds: number): string {
	if (!seconds || seconds <= 0) return "";
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function SongPicker({ value, onChange, disabled }: Props) {
	const initial = getCachedSongPickerOptions();
	const [options, setOptions] = useState<SoundtrackOption[]>(initial ?? []);
	const [loading, setLoading] = useState(!initial);

	useEffect(() => {
		if (getCachedSongPickerOptions()) return;
		let cancelled = false;
		loadSongPickerOptions()
			.then((items) => {
				if (!cancelled) setOptions(items);
			})
			.catch(() => {
				if (!cancelled) setOptions([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Select
			value={String(value)}
			onValueChange={(v) => onChange(parseInt(v, 10) || 0)}
			disabled={disabled || loading}
		>
			<SelectTrigger>
				{loading ? (
					<span className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-3 w-3 animate-spin" /> Loading…
					</span>
				) : (
					<SelectValue placeholder="No song" />
				)}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="0">
					<span className="text-muted-foreground">— No song —</span>
				</SelectItem>
				{options.map((opt) => (
					<SelectItem key={opt.id} value={String(opt.id)}>
						<span className="inline-flex items-center gap-2">
							<Music className="h-3 w-3 text-muted-foreground" />
							<span className="font-medium">{opt.name}</span>
							{opt.author && (
								<span className="text-xs text-muted-foreground">
									— {opt.author}
								</span>
							)}
							{opt.length > 0 && (
								<span className="text-xs text-muted-foreground font-mono">
									{formatLength(opt.length)}
								</span>
							)}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
