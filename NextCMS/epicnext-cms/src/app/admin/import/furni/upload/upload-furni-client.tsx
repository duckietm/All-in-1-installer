"use client";

import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImportErrorBanner } from "@/components/admin/import-error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { refreshCatalogTree } from "@/features/catalog/client/use-live-catalog";
import { adminFetch } from "@/lib/admin-fetch";

const CLASSNAME_RE = /^[a-zA-Z0-9_]+$/;
const NITRO_MAX_BYTES = 50 * 1024 * 1024;

interface UploadResult {
	itemId: number;
	catalogItemId: number | null;
	classname: string;
	warnings: string[];
	sqlFile?: string | null;
}

export function UploadFurniClient() {
	const t = useTranslations(
		"pages.admin.import.furni.upload.uploadFurniClient",
	);
	const nitroRef = useRef<HTMLInputElement>(null);
	const iconRef = useRef<HTMLInputElement>(null);

	const [classname, setClassname] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [itemType, setItemType] = useState<"s" | "i">("s");
	const [xdim, setXdim] = useState(1);
	const [ydim, setYdim] = useState(1);
	const [canstandon, setCanstandon] = useState(false);
	const [cansiton, setCansiton] = useState(false);
	const [canlayon, setCanlayon] = useState(false);
	const [interactionType, setInteractionType] = useState("default");
	const [customparams, setCustomparams] = useState("");
	const [generateSql, setGenerateSql] = useState(false);

	const [nitroFile, setNitroFile] = useState<File | null>(null);
	const [iconFile, setIconFile] = useState<File | null>(null);

	const [uploading, setUploading] = useState(false);
	const [result, setResult] = useState<UploadResult | null>(null);
	const [error, setError] = useState("");

	function resetForm() {
		setClassname("");
		setName("");
		setDescription("");
		setItemType("s");
		setXdim(1);
		setYdim(1);
		setCanstandon(false);
		setCansiton(false);
		setCanlayon(false);
		setInteractionType("default");
		setCustomparams("");
		setGenerateSql(false);
		setNitroFile(null);
		setIconFile(null);
		setResult(null);
		setError("");
		if (nitroRef.current) nitroRef.current.value = "";
		if (iconRef.current) iconRef.current.value = "";
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setResult(null);

		const trimmedClass = classname.trim();
		if (!CLASSNAME_RE.test(trimmedClass)) {
			const msg = t("errorClassname");
			setError(msg);
			toast.error(msg);
			return;
		}
		if (!nitroFile) {
			const msg = t("errorNitroRequired");
			setError(msg);
			toast.error(msg);
			return;
		}
		if (nitroFile.size > NITRO_MAX_BYTES) {
			const msg = t("errorNitroSize");
			setError(msg);
			toast.error(msg);
			return;
		}

		setUploading(true);

		try {
			const fd = new FormData();
			fd.set("classname", trimmedClass);
			fd.set("name", name.trim());
			fd.set("description", description.trim());
			fd.set("itemType", itemType);
			fd.set("xdim", String(xdim));
			fd.set("ydim", String(ydim));
			fd.set("canstandon", String(canstandon));
			fd.set("cansiton", String(cansiton));
			fd.set("canlayon", String(canlayon));
			fd.set("interactionType", interactionType.trim());
			fd.set("customparams", customparams.trim());
			if (generateSql) fd.set("generateSql", "true");
			fd.set("nitro", nitroFile);
			if (iconFile) fd.set("icon", iconFile);

			const res = await adminFetch("/cms_api/admin/import/furni/upload", {
				method: "POST",
				body: fd,
			});
			const data = await res.json();

			if (!res.ok) {
				setError(data.error || "Upload failed");
				toast.error(data.error || "Upload failed");
				return;
			}

			setResult(data);
			// The upload creates a category page server-side, so the live tree and
			// totals would stay pre-import without pulling them again.
			void refreshCatalogTree();
			toast.success(`${data.classname} imported successfully`);
		} catch {
			const msg = "Network error";
			setError(msg);
			toast.error(msg);
		} finally {
			setUploading(false);
		}
	}

	return (
		<div className="space-y-6">
			{!result ? (
				<form onSubmit={handleSubmit} className="space-y-6">
					<div className="rounded-xl border bg-card p-4 sm:p-5 space-y-5">
						<div className="text-sm font-medium">Furniture Details</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="classname">Classname *</Label>
								<Input
									id="classname"
									placeholder="e.g. rare_dragon"
									value={classname}
									onChange={(e) => setClassname(e.target.value)}
									required
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="name">Name *</Label>
								<Input
									id="name"
									placeholder="e.g. Dragon Egg"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
								/>
							</div>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Optional description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={2}
							/>
						</div>

						<div className="grid gap-4 sm:grid-cols-4">
							<div className="space-y-1.5">
								<Label htmlFor="itemType">Type *</Label>
								<select
									id="itemType"
									value={itemType}
									onChange={(e) => setItemType(e.target.value as "s" | "i")}
									className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<option value="s">Floor (s)</option>
									<option value="i">Wall (i)</option>
								</select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="xdim">Width (x)</Label>
								<Input
									id="xdim"
									type="number"
									min={1}
									max={64}
									value={xdim}
									onChange={(e) => setXdim(Number(e.target.value))}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="ydim">Length (y)</Label>
								<Input
									id="ydim"
									type="number"
									min={1}
									max={64}
									value={ydim}
									onChange={(e) => setYdim(Number(e.target.value))}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="interactionType">Interaction</Label>
								<Input
									id="interactionType"
									placeholder="default"
									value={interactionType}
									onChange={(e) => setInteractionType(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex items-center gap-4 flex-wrap">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={canstandon}
									onChange={(e) => setCanstandon(e.target.checked)}
									className="h-4 w-4 rounded border-input"
								/>
								<span className="text-sm">Can stand on</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={cansiton}
									onChange={(e) => setCansiton(e.target.checked)}
									className="h-4 w-4 rounded border-input"
								/>
								<span className="text-sm">Can sit on</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={canlayon}
									onChange={(e) => setCanlayon(e.target.checked)}
									className="h-4 w-4 rounded border-input"
								/>
								<span className="text-sm">Can lay on</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={generateSql}
									onChange={(e) => setGenerateSql(e.target.checked)}
									className="h-4 w-4 rounded border-input"
								/>
								<span className="text-sm">Generate SQL</span>
							</label>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="customparams">Custom params</Label>
							<Input
								id="customparams"
								placeholder="Optional custom parameters"
								value={customparams}
								onChange={(e) => setCustomparams(e.target.value)}
							/>
						</div>
					</div>

					<div className="rounded-xl border bg-card p-5 space-y-4">
						<div className="text-sm font-medium">Files</div>

						<div className="space-y-1.5">
							<Label htmlFor="nitro">.hab file *</Label>
							<Input
								ref={nitroRef}
								id="nitro"
								type="file"
								accept=".hab,.nitro"
								onChange={(e) => setNitroFile(e.target.files?.[0] ?? null)}
								required
							/>
							<p className="text-xs text-muted-foreground">
								The furniture bundle (max 50MB). Stored as{" "}
								<code className="font-mono">.hab</code>; a{" "}
								<code className="font-mono">.nitro</code> is accepted too.
							</p>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="icon">Icon (PNG)</Label>
							<Input
								ref={iconRef}
								id="icon"
								type="file"
								accept=".png,image/png"
								onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
							/>
							<p className="text-xs text-muted-foreground">
								Optional 64x64 PNG icon (max 2MB). Leave empty to skip.
							</p>
						</div>
					</div>

					{error && <ImportErrorBanner error={error} />}

					<div className="flex gap-3">
						<Button type="submit" disabled={uploading}>
							{uploading ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : (
								<Upload className="w-4 h-4 mr-2" />
							)}
							{uploading ? "Importing…" : "Import Furniture"}
						</Button>
					</div>
				</form>
			) : (
				<div className="rounded-xl border bg-card p-6 space-y-4">
					<div className="flex items-center gap-2">
						<Check className="w-5 h-5 text-[var(--admin-success)]" />
						<span className="text-lg font-semibold">Import Successful</span>
					</div>
					<div className="space-y-2 text-sm">
						<div className="flex gap-2">
							<span className="text-muted-foreground w-32">Classname:</span>
							<code className="font-mono">{result.classname}</code>
						</div>
						<div className="flex gap-2">
							<span className="text-muted-foreground w-32">Item ID:</span>
							<code className="font-mono">{result.itemId}</code>
						</div>
						{result.catalogItemId && (
							<div className="flex gap-2">
								<span className="text-muted-foreground w-32">Catalog ID:</span>
								<code className="font-mono">{result.catalogItemId}</code>
							</div>
						)}
						{result.sqlFile ? (
							<div className="flex gap-2">
								<span className="text-muted-foreground w-32">SQL file:</span>
								<code className="font-mono break-all">{result.sqlFile}</code>
							</div>
						) : null}
						{result.warnings.length > 0 && (
							<div className="space-y-1 pt-2">
								<span className="text-muted-foreground font-medium">
									Warnings:
								</span>
								{result.warnings.map((w) => (
									<div
										key={w}
										className="flex items-center gap-1.5 text-[var(--admin-warning)] dark:text-[var(--admin-warning)]"
									>
										<AlertCircle className="w-3 h-3 shrink-0" />
										<span>{w}</span>
									</div>
								))}
							</div>
						)}
					</div>
					<Button variant="outline" onClick={resetForm}>
						Import Another
					</Button>
				</div>
			)}
		</div>
	);
}
