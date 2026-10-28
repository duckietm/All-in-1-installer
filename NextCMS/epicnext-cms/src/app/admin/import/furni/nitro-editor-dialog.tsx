"use client";
import "./nitro-editor.css";

import {
	Box,
	Check,
	Compass,
	Copy,
	Eye,
	Layers,
	Loader2,
	MousePointerClick,
	Palette,
	RotateCcw,
	Ruler,
	Save,
	Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { adminFetch } from "@/lib/admin-fetch";
import {
	autoDetectInteraction,
	getInteractionTypeLabel,
	nitroAnimationStatesCount,
} from "@/lib/furni/auto-interaction";

const NitroQualityPanel = lazy(() =>
	import("@/components/admin/studio/nitro-quality-panel").then((module) => ({
		default: module.NitroQualityPanel,
	})),
);
const NitroScale32Generator = lazy(() =>
	import("@/components/admin/studio/nitro-scale32-generator").then(
		(module) => ({ default: module.NitroScale32Generator }),
	),
);

interface NitroEditorDialogProps {
	classname: string;
	name?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface NitroVisualization {
	size?: number;
	layers?: Record<string, { z?: number; alpha?: number; ink?: string }>;
	colors?: Record<string, Record<string, { color: number }>>;
	animations?: Record<string, unknown>;
}

// The .nitro metadata is untyped JSON from disk; typed only for the fields the
// editor reads/writes. Unknown keys are traversed via the path helpers below.
interface NitroMetadata {
	visualizationType?: string;
	logicType?: string;
	logic?: {
		model?: {
			dimensions?: { x: number; y: number; z: number };
			directions?: number[];
		};
	};
	visualizations?: NitroVisualization[];
}

type JsonObject = Record<string, unknown>;

function updateNested<T extends object>(
	obj: T,
	path: string,
	value: unknown,
): T {
	const clone: T = JSON.parse(JSON.stringify(obj));
	const keys = path.split(".");
	let current: JsonObject = clone as JsonObject;
	for (let i = 0; i < keys.length - 1; i++) {
		const next = current[keys[i]];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			current[keys[i]] = {};
		}
		current = current[keys[i]] as JsonObject;
	}
	current[keys[keys.length - 1]] = value;
	return clone;
}

function getNested<T>(obj: unknown, path: string, fallback: T): T {
	const keys = path.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (current == null || typeof current !== "object") return fallback;
		current = (current as JsonObject)[key];
	}
	return current === undefined ? fallback : (current as T);
}

const ALL_DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const DIR_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function hexToColor(hex: string): string {
	return `#${hex.padStart(6, "0")}`;
}

function CopyClassname({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground mt-0.5 hover:text-foreground transition-colors"
			onClick={() => {
				navigator.clipboard.writeText(value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
		>
			<span className="truncate">{value}</span>
			{copied ? (
				<Check className="w-3 h-3 text-[var(--admin-success)] shrink-0" />
			) : (
				<Copy className="w-3 h-3 shrink-0" />
			)}
		</button>
	);
}

export function NitroEditorDialog({
	classname,
	name = "",
	open,
	onOpenChange,
}: NitroEditorDialogProps) {
	const loadingT = useTranslations("pages.admin.housekeeping");
	const t = useTranslations("pages.admin.import.furni.nitroEditorDialog");
	const [metadata, setMetadata] = useState<NitroMetadata | null>(null);
	const [originalMetadata, setOriginalMetadata] =
		useState<NitroMetadata | null>(null);
	const [jsonText, setJsonText] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [bundleRevision, setBundleRevision] = useState(0);
	const [activeTab, setActiveTab] = useState<string>("visual");
	const [flags, setFlags] = useState({
		canstandon: false,
		cansiton: false,
		canlayon: false,
	});
	const [originalFlags, setOriginalFlags] = useState({
		canstandon: false,
		cansiton: false,
		canlayon: false,
	});
	const [autoDetectResult, setAutoDetectResult] = useState<ReturnType<
		typeof autoDetectInteraction
	> | null>(null);
	const [jsonError, setJsonError] = useState<string | null>(null);

	const handleAutoDetect = () => {
		// Use real data when available: the DB flags for this item plus the
		// .nitro animation states already loaded in the editor. Keyword
		// detection only kicks in when neither is present — no false positives.
		const nitroJson =
			metadata && typeof metadata === "object"
				? (metadata as Record<string, unknown>)
				: null;
		const result = autoDetectInteraction(classname, name, {
			cansiton: flags.cansiton,
			canlayon: flags.canlayon,
			canstandon: flags.canstandon,
			logicType: nitroJson?.logicType as string | undefined,
			animationStates: nitroAnimationStatesCount(nitroJson),
		});
		setAutoDetectResult(result);
		setFlags({
			canstandon: result.canStand,
			cansiton: result.canSit,
			canlayon: result.canLay,
		});
		toast.success(t("autoDetected", { reason: result.reason }));
	};

	const patchMeta = (path: string, value: unknown) => {
		setMetadata((prev) =>
			prev == null ? prev : updateNested(prev, path, value),
		);
	};

	const closeAfterLoadError = useEffectEvent(() => onOpenChange(false));
	useEffect(() => {
		if (!open || !classname) return;
		const controller = new AbortController();
		setActiveTab("visual");
		setLoading(true);
		setJsonError(null);
		setAutoDetectResult(null);
		void (async () => {
			try {
				const res = await adminFetch(
					`/cms_api/admin/import/furni/nitro-editor?classname=${encodeURIComponent(classname)}`,
					{ signal: controller.signal },
				);
				const data = await res.json();
				if (controller.signal.aborted) return;
				if (!res.ok) {
					toast.error(data.error || t("loadFailed"));
					closeAfterLoadError();
					return;
				}
				setMetadata(data.metadata);
				setOriginalMetadata(structuredClone(data.metadata));
				setJsonText(JSON.stringify(data.metadata, null, 2));
				setFlags(data.flags);
				setOriginalFlags({ ...data.flags });
			} catch {
				if (!controller.signal.aborted) {
					toast.error(t("networkErrorLoad"));
					closeAfterLoadError();
				}
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();
		return () => controller.abort();
	}, [open, classname, t]);

	const handleTabChange = (newTab: string) => {
		if (activeTab === "json" && newTab !== "json") {
			try {
				const parsed = JSON.parse(jsonText);
				setMetadata(parsed);
				setJsonError(null);
			} catch {
				toast.error(t("invalidJsonSwitchTabs"));
				return;
			}
		} else if (activeTab !== "json" && newTab === "json") {
			setJsonText(JSON.stringify(metadata, null, 2));
		}
		setActiveTab(newTab);
	};

	const handleReset = () => {
		if (!originalMetadata) return;
		setMetadata(JSON.parse(JSON.stringify(originalMetadata)));
		setFlags({ ...originalFlags });
		setJsonText(JSON.stringify(originalMetadata, null, 2));
		setJsonError(null);
		toast.info(t("resetToOriginal"));
	};

	const handleSave = async () => {
		let metadataToSave = metadata;

		if (activeTab === "json") {
			try {
				metadataToSave = JSON.parse(jsonText);
			} catch {
				toast.error(t("invalidJson"));
				return;
			}
		}

		setSaving(true);
		try {
			const res = await adminFetch("/cms_api/admin/import/furni/nitro-editor", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					classname,
					metadata: metadataToSave,
					...flags,
				}),
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || t("saveFailed"));
				return;
			}

			toast.success("Nitro metadata saved");
			setMetadata(metadataToSave);
			setOriginalMetadata(JSON.parse(JSON.stringify(metadataToSave)));
			setOriginalFlags({ ...flags });
			setJsonText(JSON.stringify(metadataToSave, null, 2));
		} catch {
			toast.error("Network error");
		} finally {
			setSaving(false);
		}
	};

	// ── Visual tab helpers ──

	const dims = metadata
		? getNested(metadata, "logic.model.dimensions", { x: 1, y: 1, z: 0 })
		: { x: 1, y: 1, z: 0 };
	const directions = metadata
		? getNested(metadata, "logic.model.directions", [0])
		: [0];

	const setDim = (axis: "x" | "y" | "z", value: string) => {
		const num =
			axis === "z" ? parseFloat(value) || 0 : parseInt(value, 10) || 0;
		patchMeta(`logic.model.dimensions.${axis}`, num);
	};

	const toggleDirection = (dir: number) => {
		const current = getNested(metadata, "logic.model.directions", [0]);
		const next = current.includes(dir)
			? current.filter((d: number) => d !== dir)
			: [...current, dir].sort((a: number, b: number) => a - b);
		if (next.length === 0) return;
		patchMeta("logic.model.directions", next);
	};

	// Get visualization with size=64 for layer/color editing
	const viz64 = metadata?.visualizations?.find((v) => v.size === 64);
	const viz64Index =
		metadata?.visualizations?.findIndex((v) => v.size === 64) ?? -1;

	const layerCount = viz64?.layers ? Object.keys(viz64.layers).length : 0;
	const colorCount = viz64?.colors ? Object.keys(viz64.colors).length : 0;
	const animCount = viz64?.animations
		? Object.keys(viz64.animations).length
		: 0;

	const handleJsonTextChange = (value: string) => {
		setJsonText(value);
		try {
			JSON.parse(value);
			setJsonError(null);
		} catch (e) {
			setJsonError((e as Error).message);
		}
	};

	// Check if there are unsaved changes
	const hasChanges =
		metadata &&
		originalMetadata &&
		((activeTab === "json"
			? jsonText !== JSON.stringify(originalMetadata, null, 2)
			: JSON.stringify(metadata) !== JSON.stringify(originalMetadata)) ||
			JSON.stringify(flags) !== JSON.stringify(originalFlags));

	// Furni preview URL
	const starIdx = classname.indexOf("*");
	const baseClassname =
		starIdx !== -1 ? classname.substring(0, starIdx) : classname;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-nitro-editor
				className="sm:max-w-4xl h-[min(840px,92dvh)] max-h-[92dvh] flex flex-col overflow-hidden p-0 gap-0"
			>
				{/* Header with preview */}
				<DialogHeader className="px-6 pt-5 pb-4 border-b bg-muted/30">
					<div className="flex items-start gap-4">
						{/* Furni preview */}
						<div
							className="w-16 h-16 rounded-lg border bg-card flex items-center justify-center shrink-0 overflow-hidden"
							style={{
								backgroundImage: "url(/images/furni_floor.png)",
								backgroundRepeat: "repeat",
								backgroundPosition: "center",
							}}
						>
							<img
								src={`/swf/dcr/hof_furni/icons/${baseClassname}_icon.png`}
								alt={classname}
								className="max-w-[60px] max-h-[60px] drop-shadow-md"
								style={{ imageRendering: "pixelated" }}
								onError={(e) => {
									(e.target as HTMLImageElement).style.opacity = "0";
								}}
							/>
						</div>
						<div className="flex-1 min-w-0">
							<DialogTitle className="text-lg">Edit Nitro</DialogTitle>
							<CopyClassname value={classname} />
							{/* Quick stats */}
							{metadata && (
								<div className="flex gap-2 mt-2 flex-wrap">
									<Badge variant="outline" className="text-[10px] gap-1">
										<Ruler className="w-2.5 h-2.5" />
										{dims.x}×{dims.y}×{dims.z}
									</Badge>
									<Badge variant="outline" className="text-[10px] gap-1">
										<Compass className="w-2.5 h-2.5" />
										{directions.length} dir
									</Badge>
									<Badge variant="outline" className="text-[10px] gap-1">
										<Layers className="w-2.5 h-2.5" />
										{layerCount} layers
									</Badge>
									{colorCount > 0 && (
										<Badge variant="outline" className="text-[10px] gap-1">
											<Palette className="w-2.5 h-2.5" />
											{colorCount} colors
										</Badge>
									)}
									{animCount > 0 && (
										<Badge variant="outline" className="text-[10px] gap-1">
											<Sparkles className="w-2.5 h-2.5" />
											{animCount} anim
										</Badge>
									)}
									<Badge variant="outline" className="text-[10px] gap-1">
										<Eye className="w-2.5 h-2.5" />
										{metadata.visualizationType || "?"}
									</Badge>
								</div>
							)}
						</div>
					</div>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-16">
						<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
					</div>
				) : metadata ? (
					<Tabs
						value={activeTab}
						onValueChange={handleTabChange}
						className="flex-1 flex flex-col min-h-0"
					>
						<div className="px-6 pt-3 pb-0">
							<TabsList className="w-fit">
								<TabsTrigger value="visual" className="gap-1.5">
									<Box className="w-3.5 h-3.5" />
									Visual
								</TabsTrigger>
								<TabsTrigger value="quality">32 / 64</TabsTrigger>
								<TabsTrigger value="json" className="gap-1.5">
									{"{ }"}
									JSON
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent
							value="quality"
							className="min-h-0 overflow-y-auto flex-1 px-4 sm:px-6 py-4"
						>
							<Suspense fallback={<p role="status">{loadingT("loading")}</p>}>
								<NitroScale32Generator
									classname={classname}
									disabled={hasChanges || saving}
									onChanged={(updated) => {
										setBundleRevision((value) => value + 1);
										setMetadata(updated as NitroMetadata);
										setOriginalMetadata(
											structuredClone(updated) as NitroMetadata,
										);
										setJsonText(JSON.stringify(updated, null, 2));
									}}
								/>
								<NitroQualityPanel key={bundleRevision} classname={classname} />
							</Suspense>
						</TabsContent>
						{/* ── Visual Tab ── */}
						<TabsContent
							value="visual"
							className="min-h-0 overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-4"
						>
							{/* Dimensions + Interaction in 2-column layout */}
							<div className="grid grid-cols-1 md:grid-cols-2 items-start gap-4">
								<div className="space-y-4">
									{/* Dimensions card */}
									<section className="rounded-lg border bg-card p-4">
										<div className="flex items-center gap-2 mb-3">
											<Ruler className="w-4 h-4 text-muted-foreground" />
											<h3 className="text-sm font-medium">Dimensions</h3>
										</div>
										<div className="grid grid-cols-3 gap-3">
											<div>
												<Label
													htmlFor="dim-x"
													className="text-xs text-muted-foreground"
												>
													X (width)
												</Label>
												<Input
													id="dim-x"
													type="number"
													min={1}
													value={dims.x}
													onChange={(e) => setDim("x", e.target.value)}
													className="mt-1"
												/>
											</div>
											<div>
												<Label
													htmlFor="dim-y"
													className="text-xs text-muted-foreground"
												>
													Y (depth)
												</Label>
												<Input
													id="dim-y"
													type="number"
													min={1}
													value={dims.y}
													onChange={(e) => setDim("y", e.target.value)}
													className="mt-1"
												/>
											</div>
											<div>
												<Label
													htmlFor="dim-z"
													className="text-xs text-muted-foreground"
												>
													Z (height)
												</Label>
												<Input
													id="dim-z"
													type="number"
													step={0.01}
													min={0}
													value={dims.z}
													onChange={(e) => setDim("z", e.target.value)}
													className="mt-1"
												/>
											</div>
										</div>
									</section>

									{/* Available rotations */}
									<section className="rounded-lg border bg-card p-4">
										<div className="flex items-center gap-2 mb-3">
											<Compass className="w-4 h-4 text-muted-foreground" />
											<h3 className="text-sm font-medium">Directions</h3>
											<span className="ml-auto text-xs text-muted-foreground">
												{directions.length} / 8 active
											</span>
										</div>
										<div className="grid grid-cols-4 gap-2">
											{ALL_DIRECTIONS.map((dir) => (
												<button
													key={dir}
													type="button"
													className="nitro-direction"
													aria-label={`Direction ${dir} (${DIR_LABELS[dir]})`}
													aria-pressed={directions.includes(dir)}
													onClick={() => toggleDirection(dir)}
												>
													<strong>{DIR_LABELS[dir]}</strong>
													<span>{dir}</span>
												</button>
											))}
										</div>
										<p className="mt-3 text-xs text-muted-foreground">
											Choose the available rotations. Keep at least one
											direction active.
										</p>
									</section>
								</div>
								{/* Interaction card */}
								<section className="rounded-lg border bg-card p-4">
									<div className="flex items-center gap-2 mb-3">
										<MousePointerClick className="w-4 h-4 text-muted-foreground" />
										<h3 className="text-sm font-medium">Interaction</h3>
									</div>
									<div className="flex flex-col gap-3">
										<div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors">
											<span className="text-sm">Can Stand On</span>
											<Switch
												aria-label="Can Stand On"
												checked={flags.canstandon}
												onCheckedChange={(v) =>
													setFlags((f) => ({ ...f, canstandon: !!v }))
												}
											/>
										</div>
										<div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors">
											<span className="text-sm">Can Sit On</span>
											<Switch
												aria-label="Can Sit On"
												checked={flags.cansiton}
												onCheckedChange={(v) =>
													setFlags((f) => ({ ...f, cansiton: !!v }))
												}
											/>
										</div>
										<div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors">
											<span className="text-sm">Can Lay On</span>
											<Switch
												aria-label="Can Lay On"
												checked={flags.canlayon}
												onCheckedChange={(v) =>
													setFlags((f) => ({ ...f, canlayon: !!v }))
												}
											/>
										</div>
									</div>
									<div className="mt-4 flex flex-col gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={handleAutoDetect}
											className="gap-1.5 w-full"
										>
											<Sparkles className="w-3.5 h-3.5" />
											Auto-detect from name
										</Button>
										{autoDetectResult && (
											<div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
												<div className="flex items-center gap-1.5 flex-wrap">
													<Badge
														variant={
															autoDetectResult.canLay ? "default" : "secondary"
														}
														className="gap-1"
													>
														{autoDetectResult.canLay ? (
															<Layers className="w-2.5 h-2.5" />
														) : autoDetectResult.canSit ? (
															<MousePointerClick className="w-2.5 h-2.5" />
														) : (
															<MousePointerClick className="w-2.5 h-2.5" />
														)}
														{getInteractionTypeLabel(
															autoDetectResult.interactionType,
														)}
													</Badge>
													{autoDetectResult.clickLimit > 0 && (
														<Badge variant="outline" className="gap-1">
															Click limit: {autoDetectResult.clickLimit}
														</Badge>
													)}
													{autoDetectResult.interactionModesCount > 0 && (
														<Badge variant="outline" className="gap-1">
															Modes: {autoDetectResult.interactionModesCount}
														</Badge>
													)}
												</div>
												<p className="text-muted-foreground">
													{autoDetectResult.reason}
												</p>
											</div>
										)}
									</div>
								</section>
							</div>

							{/* Types */}
							<section className="rounded-lg border bg-card p-4">
								<div className="flex items-center gap-2 mb-3">
									<Eye className="w-4 h-4 text-muted-foreground" />
									<h3 className="text-sm font-medium">Types</h3>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<Label
											htmlFor="viz-type"
											className="text-xs text-muted-foreground"
										>
											Visualization Type
										</Label>
										<Input
											id="viz-type"
											value={metadata.visualizationType || ""}
											onChange={(e) =>
												patchMeta("visualizationType", e.target.value)
											}
											className="mt-1 font-mono text-sm"
										/>
									</div>
									<div>
										<Label
											htmlFor="logic-type"
											className="text-xs text-muted-foreground"
										>
											Logic Type
										</Label>
										<Input
											id="logic-type"
											value={metadata.logicType || ""}
											onChange={(e) => patchMeta("logicType", e.target.value)}
											className="mt-1 font-mono text-sm"
										/>
									</div>
								</div>
							</section>

							{/* Layers */}
							{viz64?.layers && layerCount > 0 && (
								<section className="rounded-lg border bg-card p-4">
									<div className="flex items-center gap-2 mb-3">
										<Layers className="w-4 h-4 text-muted-foreground" />
										<h3 className="text-sm font-medium">Layer</h3>
										<Badge variant="secondary" className="text-[10px] ml-auto">
											{layerCount}
										</Badge>
									</div>
									<div className="rounded-md border overflow-hidden">
										{/* Header */}
										<div className="grid grid-cols-4 gap-2 items-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50 px-3 py-1.5">
											<span>Layer</span>
											<span>Z-Index</span>
											<span>Alpha</span>
											<span>Ink</span>
										</div>
										{Object.entries(viz64.layers).map(
											([layerId, layerData], idx) => {
												const layer = layerData as Record<string, unknown>;
												return (
													<div
														key={layerId}
														className={`grid grid-cols-4 gap-2 items-center text-sm px-3 py-1.5 ${
															idx % 2 === 0 ? "bg-card" : "bg-muted/20"
														}`}
													>
														<span className="font-mono text-xs">
															<Badge
																variant="outline"
																className="text-[10px] px-1.5"
															>
																#{layerId}
															</Badge>
														</span>
														<Input
															type="number"
															className="h-7 text-xs"
															value={(layer.z as number) ?? 0}
															onChange={(e) => {
																patchMeta(
																	`visualizations.${viz64Index}.layers.${layerId}.z`,
																	parseInt(e.target.value, 10) || 0,
																);
															}}
														/>
														<Input
															type="number"
															className="h-7 text-xs"
															min={0}
															max={255}
															value={(layer.alpha as number) ?? 255}
															onChange={(e) => {
																patchMeta(
																	`visualizations.${viz64Index}.layers.${layerId}.alpha`,
																	parseInt(e.target.value, 10) || 0,
																);
															}}
														/>
														<Input
															className="h-7 text-xs font-mono"
															value={(layer.ink as string) ?? ""}
															placeholder="—"
															onChange={(e) => {
																patchMeta(
																	`visualizations.${viz64Index}.layers.${layerId}.ink`,
																	e.target.value || undefined,
																);
															}}
														/>
													</div>
												);
											},
										)}
									</div>
								</section>
							)}

							{/* Colors */}
							{viz64?.colors && colorCount > 0 && (
								<section className="rounded-lg border bg-card p-4">
									<div className="flex items-center gap-2 mb-3">
										<Palette className="w-4 h-4 text-muted-foreground" />
										<h3 className="text-sm font-medium">Colori</h3>
										<Badge variant="secondary" className="text-[10px] ml-auto">
											{colorCount} colors
										</Badge>
									</div>
									<div className="space-y-3">
										{Object.entries(viz64.colors).map(
											([colorId, colorLayers]) => (
												<div key={colorId} className="rounded-md border p-3">
													<div className="flex items-center gap-2 mb-2">
														<span className="text-xs font-medium">
															Color Variant #{colorId}
														</span>
														{/* Color preview dots */}
														<div className="flex gap-1 ml-auto">
															{Object.values(
																colorLayers as Record<
																	string,
																	{ color: number }
																>,
															).map((lc, i) => (
																<div
																	key={i}
																	className="w-4 h-4 rounded-full border border-border shadow-sm"
																	style={{
																		backgroundColor: hexToColor(
																			typeof lc.color === "number"
																				? lc.color.toString(16).padStart(6, "0")
																				: "000000",
																		),
																	}}
																/>
															))}
														</div>
													</div>
													<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
														{Object.entries(
															colorLayers as Record<string, { color: number }>,
														).map(([layerId, layerColor]) => (
															<div
																key={layerId}
																className="flex items-center gap-2"
															>
																<Label className="text-xs text-muted-foreground shrink-0 w-6">
																	L{layerId}
																</Label>
																<div className="relative flex-1">
																	<Input
																		className="h-7 text-xs font-mono pl-8"
																		value={
																			typeof layerColor.color === "number"
																				? layerColor.color
																						.toString(16)
																						.padStart(6, "0")
																						.toUpperCase()
																				: String(layerColor.color)
																		}
																		onChange={(e) => {
																			const hex = e.target.value
																				.replace(/[^0-9a-fA-F]/g, "")
																				.slice(0, 6);
																			const num = parseInt(hex, 16) || 0;
																			patchMeta(
																				`visualizations.${viz64Index}.colors.${colorId}.${layerId}.color`,
																				num,
																			);
																		}}
																	/>
																	{/* Color swatch inside input */}
																	<div
																		className="absolute left-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded border border-border"
																		style={{
																			backgroundColor: hexToColor(
																				typeof layerColor.color === "number"
																					? layerColor.color
																							.toString(16)
																							.padStart(6, "0")
																					: "000000",
																			),
																		}}
																	/>
																</div>
															</div>
														))}
													</div>
												</div>
											),
										)}
									</div>
								</section>
							)}
						</TabsContent>

						{/* ── JSON Tab ── */}
						<TabsContent
							value="json"
							className="flex-1 flex flex-col min-h-0 px-6 py-4"
						>
							<div className="relative flex-1 min-h-0">
								<Textarea
									aria-label="Nitro metadata JSON"
									className="h-full min-h-0 font-mono text-xs resize-none"
									value={jsonText}
									onChange={(e) => handleJsonTextChange(e.target.value)}
									spellCheck={false}
								/>
								{jsonError && (
									<div className="absolute bottom-2 left-2 right-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs text-destructive">
										{jsonError}
									</div>
								)}
							</div>
						</TabsContent>
					</Tabs>
				) : null}

				<DialogFooter className="px-6 py-4 border-t bg-muted/30">
					<div className="flex items-center gap-2 w-full">
						{hasChanges && (
							<Badge
								variant="secondary"
								className="text-[10px] gap-1 animate-[pulse_1s_ease-in-out_1]"
							>
								Unsaved changes
							</Badge>
						)}
						<div className="flex-1" />
						<Button
							variant="ghost"
							size="sm"
							onClick={handleReset}
							disabled={saving || loading || !metadata || !hasChanges}
							className="gap-1.5"
						>
							<RotateCcw className="w-3.5 h-3.5" />
							Reset
						</Button>
						<Button
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button
							onClick={handleSave}
							disabled={
								saving ||
								loading ||
								!metadata ||
								!hasChanges ||
								(activeTab === "json" && !!jsonError)
							}
							className="gap-1.5"
						>
							{saving ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Save className="w-4 h-4" />
							)}
							Save
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
