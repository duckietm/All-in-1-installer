"use client";

import {
	Layers,
	Loader2,
	Music,
	Pencil,
	Plus,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteSoundtrack, updateSoundtrack } from "@/actions/soundtracks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { adminFetch } from "@/lib/admin-fetch";
import { logger } from "@/lib/browser-log";
import { invalidateSongPickerCache } from "@/lib/client-cache/song-picker-cache";
import { parseTraxChannels } from "@/lib/trax-format";
import { TraxPlayer } from "./trax-player";

interface SoundtrackRow {
	id: number;
	code: string;
	name: string;
	author: string;
	length: number;
	track: string;
	samples: number[];
	kind: "single" | "composition";
	usedBy: number;
}

function formatLength(seconds: number): string {
	if (!seconds || seconds <= 0) return "—";
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSamples(samples: number[]): string {
	if (samples.length === 0) return "—";
	if (samples.length <= 20) return samples.join(", ");
	return `${samples.slice(0, 20).join(", ")}, …(+${samples.length - 20})`;
}

export function SoundsClient({
	soundtracks,
	canEdit,
	baseUrl,
}: {
	soundtracks: SoundtrackRow[];
	canEdit: boolean;
	baseUrl: string;
}) {
	const t = useTranslations("pages.admin.sounds.soundsClient");
	const router = useRouter();
	const { run, isPending } = useServerAction();

	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<
		"all" | "single" | "composition"
	>("all");
	const [uploadOpen, setUploadOpen] = useState(false);
	const [editing, setEditing] = useState<SoundtrackRow | null>(null);
	const [deleting, setDeleting] = useState<SoundtrackRow | null>(null);
	const [playingId, setPlayingId] = useState<number | null>(null);

	const counts = useMemo(() => {
		let single = 0;
		let composition = 0;
		for (const s of soundtracks) {
			if (s.kind === "composition") composition++;
			else single++;
		}
		return { single, composition };
	}, [soundtracks]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return soundtracks.filter((s) => {
			if (kindFilter !== "all" && s.kind !== kindFilter) return false;
			if (!q) return true;
			return (
				s.name.toLowerCase().includes(q) ||
				s.author.toLowerCase().includes(q) ||
				s.code.toLowerCase().includes(q) ||
				String(s.id).includes(q)
			);
		});
	}, [soundtracks, query, kindFilter]);

	function handleDelete() {
		if (!deleting) return;
		const id = deleting.id;
		run(() => deleteSoundtrack({ id }), {
			successMessage: t("deleteSuccess", { id }),
			errorMessage: t("deleteError", { id }),
			onSuccess: () => {
				invalidateSongPickerCache();
				setDeleting(null);
				router.refresh();
			},
		});
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-[220px] max-w-sm">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("searchPlaceholder")}
						className="pl-8"
					/>
				</div>
				<Select
					value={kindFilter}
					onValueChange={(v) => setKindFilter(v as typeof kindFilter)}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{t("filterAll", { count: soundtracks.length })}
						</SelectItem>
						<SelectItem value="single">
							{t("filterSingle", { count: counts.single })}
						</SelectItem>
						<SelectItem value="composition">
							{t("filterComposition", { count: counts.composition })}
						</SelectItem>
					</SelectContent>
				</Select>
				<div className="text-sm text-muted-foreground">
					{filtered.length} / {soundtracks.length}
				</div>
				<div className="flex-1" />
				{canEdit && (
					<Button onClick={() => setUploadOpen(true)} disabled={isPending}>
						<Plus className="h-4 w-4 mr-1" />
						Upload MP3
					</Button>
				)}
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">ID</TableHead>
							<TableHead className="w-24">Type</TableHead>
							<TableHead className="w-40">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Author</TableHead>
							<TableHead className="w-20">Length</TableHead>
							<TableHead className="w-20">Used</TableHead>
							<TableHead className="w-[300px]">Preview / Samples</TableHead>
							{canEdit && (
								<TableHead className="w-24 text-right">Actions</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={canEdit ? 9 : 8}
									className="text-center text-muted-foreground py-8"
								>
									{soundtracks.length === 0 ? (
										<div className="flex flex-col items-center gap-2">
											<Music className="h-8 w-8 opacity-50" />
											<p>No song disks uploaded yet.</p>
											{canEdit && (
												<p className="text-xs">
													Click &ldquo;Upload MP3&rdquo; to get started.
												</p>
											)}
										</div>
									) : (
										<>No results for the active filters.</>
									)}
								</TableCell>
							</TableRow>
						) : (
							filtered.map((s) => (
								<TableRow key={s.id}>
									<TableCell className="font-mono text-xs">{s.id}</TableCell>
									<TableCell>
										{s.kind === "composition" ? (
											<Badge variant="outline" className="gap-1">
												<Layers className="h-3 w-3" />
												Trax
											</Badge>
										) : (
											<Badge variant="secondary" className="gap-1">
												<Music className="h-3 w-3" />
												MP3
											</Badge>
										)}
									</TableCell>
									<TableCell className="font-mono text-xs break-all">
										{s.code}
									</TableCell>
									<TableCell className="font-medium">{s.name}</TableCell>
									<TableCell className="text-muted-foreground">
										{s.author || "—"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{formatLength(s.length)}
									</TableCell>
									<TableCell>
										{s.usedBy > 0 ? (
											<Badge variant="secondary">{s.usedBy}</Badge>
										) : (
											<span className="text-muted-foreground text-xs">0</span>
										)}
									</TableCell>
									<TableCell>
										{s.kind === "composition" ? (
											<div className="space-y-1 max-w-[300px]">
												<TraxPlayer
													channels={parseTraxChannels(s.track)}
													baseUrl={baseUrl}
													expectedLength={s.length}
												/>
												<div
													className="text-[10px] text-muted-foreground font-mono truncate"
													title={`Sample usati (${s.samples.length}): ${formatSamples(s.samples)}`}
												>
													{s.samples.length} sample: {formatSamples(s.samples)}
												</div>
											</div>
										) : playingId === s.id ? (
											// biome-ignore lint/a11y/useMediaCaption: hotel soundtrack preview, no caption track available
											<audio
												controls
												autoPlay
												src={`${baseUrl}${encodeURIComponent(s.code)}.mp3`}
												className="h-8 max-w-[280px]"
												onEnded={() => setPlayingId(null)}
												onError={() =>
													toast.error(
														`Failed to play "${s.code}.mp3" from ${baseUrl}.`,
													)
												}
											/>
										) : (
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setPlayingId(s.id)}
											>
												▶ Play
											</Button>
										)}
									</TableCell>
									{canEdit && (
										<TableCell className="text-right">
											<div className="inline-flex gap-1">
												<Button
													size="icon"
													variant="ghost"
													className="h-8 w-8"
													onClick={() => setEditing(s)}
													disabled={isPending}
													title="Edit"
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													size="icon"
													variant="ghost"
													className="h-8 w-8 text-destructive hover:text-destructive"
													onClick={() => setDeleting(s)}
													disabled={isPending}
													title="Delete"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									)}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{canEdit && (
				<UploadDialog
					open={uploadOpen}
					onOpenChange={setUploadOpen}
					onUploaded={() => {
						invalidateSongPickerCache();
						router.refresh();
					}}
				/>
			)}

			{canEdit && editing && (
				<EditDialog
					soundtrack={editing}
					onOpenChange={(open) => !open && setEditing(null)}
					onSaved={() => {
						invalidateSongPickerCache();
						setEditing(null);
						router.refresh();
					}}
				/>
			)}

			{canEdit && deleting && (
				<Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Delete &ldquo;{deleting.name}&rdquo;?</DialogTitle>
							<DialogDescription>
								{deleting.usedBy > 0 ? (
									<>
										This song disk is currently used by{" "}
										<strong>{deleting.usedBy}</strong> catalog item
										{deleting.usedBy === 1 ? "" : "s"}. Deleting it will reset
										those catalog items to &ldquo;no song disk&rdquo;.
										{deleting.kind === "single" && (
											<> The MP3 file will be removed from disk.</>
										)}{" "}
										This action cannot be undone.
									</>
								) : (
									<>
										{deleting.kind === "single"
											? "The MP3 file will be removed from disk and the row from the database."
											: "The row will be removed from the database. No file is deleted (a composition has no dedicated MP3)."}{" "}
										This action cannot be undone.
									</>
								)}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setDeleting(null)}
								disabled={isPending}
							>
								Cancel
							</Button>
							<Button
								variant="destructive"
								onClick={handleDelete}
								disabled={isPending}
							>
								{isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
								Delete
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}

// ── Upload dialog ────────────────────────────────────────────────────

function UploadDialog({
	open,
	onOpenChange,
	onUploaded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUploaded: () => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [author, setAuthor] = useState("");
	const [uploading, setUploading] = useState(false);

	function reset() {
		setName("");
		setAuthor("");
		if (fileRef.current) fileRef.current.value = "";
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const file = fileRef.current?.files?.[0];
		if (!file) {
			toast.error("Select an MP3 file.");
			return;
		}
		if (!name.trim()) {
			toast.error("Name is required.");
			return;
		}

		setUploading(true);
		const fd = new FormData();
		fd.append("file", file);
		fd.append("name", name.trim());
		fd.append("author", author.trim());

		try {
			const res = await adminFetch("/cms_api/admin/sounds/upload", {
				method: "POST",
				body: fd,
			});
			const json = (await res.json()) as {
				ok?: boolean;
				error?: string;
				id?: number;
			};
			if (!res.ok || !json.ok) {
				toast.error(json.error || "Upload failed.");
				return;
			}
			toast.success(`Song disk #${json.id} uploaded.`);
			reset();
			onOpenChange(false);
			onUploaded();
		} catch (err) {
			logger.error("Sound upload failed", {
				err: err as Error,
			});
			toast.error("Network error during upload.");
		} finally {
			setUploading(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!uploading) onOpenChange(o);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Upload Song Disk</DialogTitle>
					<DialogDescription>
						Upload an MP3 file. Max size 10 MB. The code will be generated
						automatically as <code>song_&#123;id&#125;</code>.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="sound-file">MP3 file</Label>
						<Input
							id="sound-file"
							type="file"
							accept=".mp3,audio/mpeg"
							ref={fileRef}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="sound-name">Name</Label>
						<Input
							id="sound-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Track title"
							maxLength={100}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="sound-author">Author</Label>
						<Input
							id="sound-author"
							value={author}
							onChange={(e) => setAuthor(e.target.value)}
							placeholder="Author (optional)"
							maxLength={50}
						/>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={uploading}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={uploading}>
							{uploading ? (
								<Loader2 className="h-4 w-4 mr-1 animate-spin" />
							) : (
								<Upload className="h-4 w-4 mr-1" />
							)}
							Upload
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ── Edit dialog ──────────────────────────────────────────────────────

function EditDialog({
	soundtrack,
	onOpenChange,
	onSaved,
}: {
	soundtrack: SoundtrackRow;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const [name, setName] = useState(soundtrack.name);
	const [author, setAuthor] = useState(soundtrack.author);
	const [track, setTrack] = useState(soundtrack.track ?? "");
	const [length, setLength] = useState(String(soundtrack.length ?? 0));
	const { run, isPending } = useServerAction();

	const isComposition = soundtrack.kind === "composition";

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) {
			toast.error("Name is required.");
			return;
		}
		const lenNum = Number.parseInt(length, 10);
		if (!Number.isFinite(lenNum) || lenNum < 0) {
			toast.error("Length must be a number ≥ 0.");
			return;
		}
		run(
			() =>
				updateSoundtrack({
					id: soundtrack.id,
					name: name.trim(),
					author: author.trim(),
					track: isComposition ? track : (soundtrack.track ?? ""),
					length: lenNum,
				}),
			{
				successMessage: "Song disk updated.",
				errorMessage: "Unable to update the song disk.",
				onSuccess: onSaved,
			},
		);
	}

	return (
		<Dialog open onOpenChange={(o) => !o && onOpenChange(false)}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						Edit {isComposition ? "Trax Composition" : "Song Disk"}
					</DialogTitle>
					<DialogDescription>
						<span className="font-mono text-xs">{soundtrack.code}</span>
						{isComposition ? (
							<>
								{" "}
								— composition of {soundtrack.samples.length} samples. Edit the{" "}
								<code>track</code> field only if you know what you are doing.
							</>
						) : (
							<>
								{" "}
								— the MP3 file cannot be replaced: delete and re-upload if you
								need to change the audio.
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="edit-name">Name</Label>
						<Input
							id="edit-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="edit-author">Author</Label>
						<Input
							id="edit-author"
							value={author}
							onChange={(e) => setAuthor(e.target.value)}
							maxLength={50}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="edit-length">Length (seconds)</Label>
						<Input
							id="edit-length"
							type="number"
							min={0}
							value={length}
							onChange={(e) => setLength(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							{isComposition
								? "Total composition length. Leave 0 if unknown."
								: "Set automatically from the upload. Edit only if incorrect."}
						</p>
					</div>

					{isComposition && (
						<div className="space-y-1">
							<Label htmlFor="edit-track">Track (Trax composition)</Label>
							<Textarea
								id="edit-track"
								value={track}
								onChange={(e) => setTrack(e.target.value)}
								rows={5}
								className="font-mono text-xs"
								placeholder="1:371,8;374,4;378,4;0,4;…"
							/>
							<p className="text-xs text-muted-foreground">
								Format: <code>channel:sample_id,length;sample_id,length;…</code>{" "}
								— <code>0</code> = silence. Detected sample IDs:{" "}
								<span className="font-mono">
									{soundtrack.samples.join(", ") || "—"}
								</span>
								.
							</p>
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
