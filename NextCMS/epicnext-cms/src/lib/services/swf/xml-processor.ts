/**
 * XML parser and XML data processor functions for SWF-to-Nitro conversion.
 *
 * Pure string/data processing — no external imports needed.
 */

// ── Interfaces ─────────────────────────────────────────────────────

export interface AssetOffset {
	x: number;
	y: number;
}

export interface NitroVisualization {
	layerCount: number;
	angle: number;
	size: number;
	layers?: Record<string, Record<string, unknown>>;
	directions?: Record<string, Record<string, unknown>>;
	colors?: Record<string, unknown>;
	animations?: Record<string, unknown>;
	postures?: {
		defaultPosture?: string;
		postures?: { id: string; animationId: number }[];
	};
	gestures?: { id: string; animationId: number }[];
}

// ── Minimal XML Parser ─────────────────────────────────────────────

export interface XmlNode {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
}

export function parseXml(xml: string): XmlNode | null {
	const stack: XmlNode[] = [];
	const nodes: XmlNode[] = [];

	// Remove XML declaration and comments
	const clean = xml
		.replace(/<\?[^?]*\?>/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim();

	const tagRe =
		/<\/?([a-zA-Z_][\w.-]*)((?:\s+[a-zA-Z_][\w.-]*\s*=\s*"[^"]*")*)\s*\/?>/g;
	let lastIndex = 0;

	for (const match of clean.matchAll(tagRe)) {
		const fullMatch = match[0];
		const tagName = match[1];
		const attrsStr = match[2] || "";
		const matchIndex = match.index ?? 0;

		const text = clean.substring(lastIndex, matchIndex).trim();
		if (text && stack.length > 0) {
			stack[stack.length - 1].text += text;
		}
		lastIndex = matchIndex + fullMatch.length;

		if (fullMatch.startsWith("</")) {
			if (stack.length > 0) {
				const node = stack.pop();
				if (!node) continue;
				if (stack.length > 0) {
					stack[stack.length - 1].children.push(node);
				} else {
					nodes.push(node);
				}
			}
		} else {
			const attrs: Record<string, string> = {};
			const attrRe = /([a-zA-Z_][\w.-]*)\s*=\s*"([^"]*)"/g;
			for (const am of attrsStr.matchAll(attrRe)) {
				attrs[am[1]] = am[2];
			}

			const node: XmlNode = { tag: tagName, attrs, children: [], text: "" };

			if (fullMatch.endsWith("/>")) {
				if (stack.length > 0) {
					stack[stack.length - 1].children.push(node);
				} else {
					nodes.push(node);
				}
			} else {
				stack.push(node);
			}
		}
	}

	while (stack.length > 1) {
		const node = stack.pop();
		if (!node) break;
		stack[stack.length - 1].children.push(node);
	}
	if (stack.length === 1) nodes.push(stack[0]);

	return nodes[0] || null;
}

export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
	return node.children.find((c) => c.tag === tag);
}

export function findChildren(node: XmlNode, tag: string): XmlNode[] {
	return node.children.filter((c) => c.tag === tag);
}

// ── XML Data Processors ────────────────────────────────────────────

export interface ManifestAsset {
	name: string;
	x: number;
	y: number;
}

export function processManifest(xml: string): { assets: ManifestAsset[] } {
	const assets: ManifestAsset[] = [];
	const root = parseXml(xml);
	if (!root) return { assets };

	const libNode = root.tag === "manifest" ? findChild(root, "library") : root;
	if (!libNode) return { assets };

	const assetsNode = findChild(libNode, "assets");
	if (!assetsNode) return { assets };

	for (const asset of findChildren(assetsNode, "asset")) {
		const name = asset.attrs.name || "";
		if (!name) continue;
		// Skip shadow sprites
		if (name.startsWith("sh_")) continue;

		let x = 0,
			y = 0;
		const paramNode = findChild(asset, "param");
		if (paramNode && paramNode.attrs.key === "offset") {
			const parts = (paramNode.attrs.value || "").split(",");
			x = parseInt(parts[0] || "0", 10);
			y = parseInt(parts[1] || "0", 10);
		}

		assets.push({ name, x, y });
	}

	return { assets };
}

export interface PaletteEntry {
	id: number;
	source?: string;
	master?: boolean;
	tags?: string[];
	breed?: number;
	colorTag?: number;
	color1?: string;
	color2?: string;
}

export function processAssetsXml(xml: string): {
	offsets: Map<string, AssetOffset>;
	palettes: Record<string, PaletteEntry>;
} {
	const offsets = new Map<string, AssetOffset>();
	const palettes: Record<string, PaletteEntry> = {};
	const root = parseXml(xml);
	if (!root) return { offsets, palettes };

	const assetsNode =
		root.tag === "assets" ? root : findChild(root, "assets") || root;

	for (const asset of findChildren(assetsNode, "asset")) {
		const name = asset.attrs.name || "";
		if (!name) continue;

		const x = parseInt(asset.attrs.x || "0", 10);
		const y = parseInt(asset.attrs.y || "0", 10);

		offsets.set(name, { x, y });
	}

	// Parse palettes
	for (const pal of findChildren(assetsNode, "palette")) {
		const id = parseInt(pal.attrs.id || "0", 10);
		const entry: PaletteEntry = { id };
		if (pal.attrs.source) entry.source = pal.attrs.source;
		if (pal.attrs.master === "1" || pal.attrs.master === "true")
			entry.master = true;
		if (pal.attrs.tags) entry.tags = pal.attrs.tags.split(",");
		if (pal.attrs.breed) entry.breed = parseInt(pal.attrs.breed, 10);
		if (pal.attrs.colorTag) entry.colorTag = parseInt(pal.attrs.colorTag, 10);
		if (pal.attrs.color1) entry.color1 = pal.attrs.color1;
		if (pal.attrs.color2) entry.color2 = pal.attrs.color2;
		palettes[String(id)] = entry;
	}

	return { offsets, palettes };
}

export function processIndex(xml: string): {
	visualizationType: string;
	logicType: string;
	specialtype: number;
} | null {
	const root = parseXml(xml);
	if (!root) return null;

	const obj = root.tag === "object" ? root : findChild(root, "object");
	if (!obj) return null;

	return {
		visualizationType: obj.attrs.visualization || "",
		logicType: obj.attrs.logic || "",
		specialtype: parseInt(obj.attrs.specialtype || "0", 10),
	};
}

export interface LogicResult {
	dimensions: { x: number; y: number; z: number; centerZ?: number };
	directions: number[];
	maskType: string;
	canstandon: boolean;
	cansiton: boolean;
	canlayon: boolean;
	/** True when the logic XML actually declared <action> nodes — flags are then authoritative. */
	hasActions: boolean;
	action?: { link?: string; startState?: number };
	credits?: string;
	soundSample?: { id: number; noPitch?: boolean };
	customVars?: { variables: string[] };
	particleSystems?: Record<string, unknown>[];
	planetSystems?: Record<string, unknown>[];
}

export function processLogic(xml: string): LogicResult {
	const defaults: LogicResult = {
		dimensions: { x: 1, y: 1, z: 0 },
		directions: [0],
		maskType: "",
		canstandon: false,
		cansiton: false,
		canlayon: false,
		hasActions: false,
	};
	const root = parseXml(xml);
	if (!root) return defaults;

	const model = findChild(root, "model") || root;
	const dims = findChild(model, "dimensions");
	const dirsNode = findChild(model, "directions");

	const dimensions: LogicResult["dimensions"] = {
		x: parseInt(dims?.attrs.x || "1", 10),
		y: parseInt(dims?.attrs.y || "1", 10),
		z: parseFloat(dims?.attrs.z || "0"),
	};
	if (dims?.attrs.centerZ) {
		dimensions.centerZ = parseFloat(dims.attrs.centerZ);
	}

	const directions: number[] = [];
	if (dirsNode) {
		for (const d of findChildren(dirsNode, "direction")) {
			directions.push(parseInt(d.attrs.id || "0", 10));
		}
	}
	// Default directions [0, 90] when missing (matches Retrosprite behavior)
	if (directions.length === 0) directions.push(0, 90);

	// Parse mask type
	const maskNode = findChild(root, "mask");
	const maskType = maskNode?.attrs.type || "";

	// Infer canstandon/cansiton/canlayon from action nodes
	const actions = findChildren(root, "action");
	const cansiton = actions.some((a) => a.attrs.kind === "sit");
	const canlayon = actions.some((a) => a.attrs.kind === "lay");
	const canstandon = !cansiton && !canlayon && dimensions.z > 0;

	const result: LogicResult = {
		dimensions,
		directions,
		maskType,
		canstandon,
		cansiton,
		canlayon,
		hasActions: actions.length > 0,
	};

	// Parse action link/startState
	const actionNode = findChild(root, "action");
	if (actionNode && (actionNode.attrs.link || actionNode.attrs.startState)) {
		const action: LogicResult["action"] = {};
		if (actionNode.attrs.link) action.link = actionNode.attrs.link;
		if (actionNode.attrs.startState)
			action.startState = parseInt(actionNode.attrs.startState, 10);
		result.action = action;
	}

	// Parse credits
	const creditsNode = findChild(root, "credits");
	if (creditsNode?.attrs.value) {
		result.credits = creditsNode.attrs.value;
	}

	// Parse soundSample
	const soundNode = findChild(root, "sound");
	if (soundNode) {
		const sampleNode = findChild(soundNode, "sample");
		if (sampleNode) {
			const sample: LogicResult["soundSample"] = {
				id: parseInt(sampleNode.attrs.id || "0", 10),
			};
			if (sampleNode.attrs.noPitch === "1") sample.noPitch = true;
			result.soundSample = sample;
		}
	}

	// Parse customVars
	const customVarsNode = findChild(root, "customVars");
	if (customVarsNode) {
		const variables: string[] = [];
		for (const v of findChildren(customVarsNode, "variable")) {
			if (v.attrs.name) variables.push(v.attrs.name);
		}
		if (variables.length > 0) result.customVars = { variables };
	}

	// Parse particleSystems
	const particleNode = findChild(root, "particleSystems");
	if (particleNode) {
		const systems: Record<string, unknown>[] = [];
		for (const ps of findChildren(particleNode, "particleSystem")) {
			const system: Record<string, unknown> = {};
			if (ps.attrs.size) system.size = parseInt(ps.attrs.size, 10);
			if (ps.attrs.canvasId) system.canvasId = parseInt(ps.attrs.canvasId, 10);
			if (ps.attrs.offsetY) system.offsetY = parseInt(ps.attrs.offsetY, 10);
			if (ps.attrs.blend) system.blend = parseInt(ps.attrs.blend, 10);
			if (ps.attrs.bgColor) system.bgColor = ps.attrs.bgColor;

			const emitters: Record<string, unknown>[] = [];
			for (const em of findChildren(ps, "emitter")) {
				const emitter: Record<string, unknown> = {};
				if (em.attrs.id) emitter.id = parseInt(em.attrs.id, 10);
				if (em.attrs.name) emitter.name = em.attrs.name;
				if (em.attrs.spriteId)
					emitter.spriteId = parseInt(em.attrs.spriteId, 10);
				if (em.attrs.maxNumParticles)
					emitter.maxNumParticles = parseInt(em.attrs.maxNumParticles, 10);
				if (em.attrs.particlesPerFrame)
					emitter.particlesPerFrame = parseInt(em.attrs.particlesPerFrame, 10);
				if (em.attrs.burstPulse)
					emitter.burstPulse = parseInt(em.attrs.burstPulse, 10);
				if (em.attrs.fuseTime)
					emitter.fuseTime = parseInt(em.attrs.fuseTime, 10);

				const simNode = findChild(em, "simulation");
				if (simNode) {
					const simulation: Record<string, unknown> = {};
					if (simNode.attrs.force)
						simulation.force = parseFloat(simNode.attrs.force);
					if (simNode.attrs.direction)
						simulation.direction = parseFloat(simNode.attrs.direction);
					if (simNode.attrs.gravity)
						simulation.gravity = parseFloat(simNode.attrs.gravity);
					if (simNode.attrs.airFriction)
						simulation.airFriction = parseFloat(simNode.attrs.airFriction);
					if (simNode.attrs.shape) simulation.shape = simNode.attrs.shape;
					if (simNode.attrs.energy)
						simulation.energy = parseFloat(simNode.attrs.energy);
					emitter.simulation = simulation;
				}

				const particles: Record<string, unknown>[] = [];
				for (const p of findChildren(em, "particle")) {
					const particle: Record<string, unknown> = {};
					if (p.attrs.isEmitter === "1") particle.isEmitter = true;
					if (p.attrs.lifeTime)
						particle.lifeTime = parseInt(p.attrs.lifeTime, 10);
					if (p.attrs.fade === "1") particle.fade = true;
					const pFrames: string[] = [];
					for (const pf of findChildren(p, "frame")) {
						if (pf.attrs.name) pFrames.push(pf.attrs.name);
					}
					if (pFrames.length > 0) particle.frames = pFrames;
					particles.push(particle);
				}
				if (particles.length > 0) emitter.particles = particles;
				emitters.push(emitter);
			}
			if (emitters.length > 0) system.emitters = emitters;
			systems.push(system);
		}
		if (systems.length > 0) result.particleSystems = systems;
	}

	// Parse planetSystems
	const planetNode = findChild(root, "planetSystems");
	if (planetNode) {
		const systems: Record<string, unknown>[] = [];
		for (const ps of planetNode.children) {
			const system: Record<string, unknown> = { ...ps.attrs };
			// Convert numeric attrs
			for (const key of Object.keys(system)) {
				const val = system[key] as string;
				if (/^-?\d+(\.\d+)?$/.test(val)) system[key] = parseFloat(val);
			}
			systems.push(system);
		}
		if (systems.length > 0) result.planetSystems = systems;
	}

	return result;
}

export function processVisualization(xml: string): NitroVisualization[] {
	const result: NitroVisualization[] = [];
	const root = parseXml(xml);
	if (!root) return result;

	const graphics = findChild(root, "graphics") || root;

	for (const viz of findChildren(graphics, "visualization")) {
		const size = parseInt(viz.attrs.size || "64", 10);
		// Keep size 1 (special), 32 (small catalog icons) and 64 (standard) so the
		// bundle renders correctly at every scale the client requests.
		if (size <= 0) continue;

		const layerCount = parseInt(viz.attrs.layerCount || "1", 10);
		const angle = parseInt(viz.attrs.angle || "45", 10);

		const entry: NitroVisualization = { layerCount, angle, size };

		// Layers (before directions to match reference key order)
		const layersNode = findChild(viz, "layers");
		if (layersNode) {
			const layers: Record<string, Record<string, unknown>> = {};
			for (const l of findChildren(layersNode, "layer")) {
				const id = l.attrs.id || "0";
				const layerObj: Record<string, unknown> = {};
				if (l.attrs.x) layerObj.x = parseInt(l.attrs.x, 10);
				if (l.attrs.y) layerObj.y = parseInt(l.attrs.y, 10);
				if (l.attrs.z) layerObj.z = parseInt(l.attrs.z, 10);
				if (l.attrs.alpha) layerObj.alpha = parseInt(l.attrs.alpha, 10);
				if (l.attrs.ink) layerObj.ink = l.attrs.ink;
				if (l.attrs.tag) layerObj.tag = l.attrs.tag;
				if (l.attrs.ignoreMouse)
					layerObj.ignoreMouse = l.attrs.ignoreMouse === "1";
				layers[id] = layerObj;
			}
			if (Object.keys(layers).length > 0) entry.layers = layers;
		}

		// Directions
		const dirsNode = findChild(viz, "directions");
		if (dirsNode) {
			const dirs: Record<string, Record<string, unknown>> = {};
			for (const d of findChildren(dirsNode, "direction")) {
				const id = d.attrs.id || "0";
				const layersInDir = findChildren(d, "layer");
				if (layersInDir.length > 0) {
					const layerData: Record<string, Record<string, unknown>> = {};
					for (const l of layersInDir) {
						const lid = l.attrs.id || "0";
						const layerObj: Record<string, unknown> = {};
						if (l.attrs.x) layerObj.x = parseInt(l.attrs.x, 10);
						if (l.attrs.y) layerObj.y = parseInt(l.attrs.y, 10);
						if (l.attrs.z) layerObj.z = parseFloat(l.attrs.z);
						if (l.attrs.alpha) layerObj.alpha = parseInt(l.attrs.alpha, 10);
						if (l.attrs.ink) layerObj.ink = l.attrs.ink;
						if (l.attrs.tag) layerObj.tag = l.attrs.tag;
						if (l.attrs.ignoreMouse)
							layerObj.ignoreMouse = l.attrs.ignoreMouse === "1";
						layerData[lid] = layerObj;
					}
					dirs[id] = { layers: layerData };
				} else {
					dirs[id] = {};
				}
			}
			entry.directions = dirs;
		}

		// Colors
		const colorsNode = findChild(viz, "colors");
		if (colorsNode) {
			const colors: Record<
				string,
				{ layers: Record<string, { color: number }> }
			> = {};
			for (const color of findChildren(colorsNode, "color")) {
				const cid = color.attrs.id || "0";
				const colorLayers: Record<string, { color: number }> = {};
				for (const cl of findChildren(color, "colorLayer")) {
					colorLayers[cl.attrs.id || "0"] = {
						color: parseInt(cl.attrs.color || "0", 16),
					};
				}
				colors[cid] = { layers: colorLayers };
			}
			if (Object.keys(colors).length > 0) entry.colors = colors;
		}

		// Animations
		const animsNode = findChild(viz, "animations");
		if (animsNode) {
			const animations: Record<string, unknown> = {};
			for (const anim of findChildren(animsNode, "animation")) {
				const aid = anim.attrs.id || "0";
				const animLayers: Record<string, unknown> = {};
				for (const al of findChildren(anim, "animationLayer")) {
					const alid = al.attrs.id || "0";
					const frameSeqs: Record<string, unknown> = {};
					for (const fs of findChildren(al, "frameSequence")) {
						const fsid =
							fs.attrs.id || Object.keys(frameSeqs).length.toString();
						const frames: Record<string, Record<string, unknown>> = {};
						let fi = 0;
						for (const f of findChildren(fs, "frame")) {
							const rawId = f.attrs.id || "0";
							const frameObj: Record<string, unknown> = {
								id: (rawId === "NaN" ? 0 : parseInt(rawId, 10)) || 0,
							};
							if (f.attrs.x) frameObj.x = parseInt(f.attrs.x, 10);
							if (f.attrs.y) frameObj.y = parseInt(f.attrs.y, 10);
							if (f.attrs.randomX)
								frameObj.randomX = parseInt(f.attrs.randomX, 10);
							if (f.attrs.randomY)
								frameObj.randomY = parseInt(f.attrs.randomY, 10);
							// Per-direction offsets (keyed by sequential index, matching Retrosprite format)
							const offsetNodes = findChildren(f, "offset");
							if (offsetNodes.length > 0) {
								const offsets: Record<
									string,
									{ direction: number; x: number; y: number }
								> = {};
								for (let oi = 0; oi < offsetNodes.length; oi++) {
									const o = offsetNodes[oi];
									offsets[String(oi)] = {
										direction: parseInt(o.attrs.direction || "0", 10),
										x: parseInt(o.attrs.x || "0", 10),
										y: parseInt(o.attrs.y || "0", 10),
									};
								}
								frameObj.offsets = offsets;
							}
							frames[String(fi)] = frameObj;
							fi++;
						}
						const seqObj: Record<string, unknown> = { frames };
						if (fs.attrs.loopCount)
							seqObj.loopCount = parseInt(fs.attrs.loopCount, 10);
						if (fs.attrs.random) seqObj.random = parseInt(fs.attrs.random, 10);
						frameSeqs[fsid] = seqObj;
					}
					const layerObj: Record<string, unknown> = {
						loopCount: parseInt(al.attrs.loopCount || "0", 10),
						frameSequences: frameSeqs,
					};
					if (al.attrs.frameRepeat)
						layerObj.frameRepeat = parseInt(al.attrs.frameRepeat, 10);
					if (al.attrs.random) layerObj.random = parseInt(al.attrs.random, 10);
					animLayers[alid] = layerObj;
				}
				const animObj: Record<string, unknown> = { layers: animLayers };
				if (anim.attrs.transitionTo)
					animObj.transitionTo = parseInt(anim.attrs.transitionTo, 10);
				if (anim.attrs.transitionFrom)
					animObj.transitionFrom = parseInt(anim.attrs.transitionFrom, 10);
				if (anim.attrs.immediateChangeFrom)
					animObj.immediateChangeFrom = anim.attrs.immediateChangeFrom;
				if (anim.attrs.randomStart === "1") animObj.randomStart = true;
				animations[aid] = animObj;
			}
			if (Object.keys(animations).length > 0) entry.animations = animations;
		}

		// Postures
		const posturesNode = findChild(viz, "postures");
		if (posturesNode) {
			const posturesList: { id: string; animationId: number }[] = [];
			for (const p of findChildren(posturesNode, "posture")) {
				posturesList.push({
					id: p.attrs.id || "",
					animationId: parseInt(p.attrs.animationId || "0", 10),
				});
			}
			const posturesObj: NitroVisualization["postures"] = {};
			if (posturesNode.attrs.defaultPosture)
				posturesObj.defaultPosture = posturesNode.attrs.defaultPosture;
			if (posturesList.length > 0) posturesObj.postures = posturesList;
			entry.postures = posturesObj;
		}

		// Gestures
		const gesturesNode = findChild(viz, "gestures");
		if (gesturesNode) {
			const gesturesList: { id: string; animationId: number }[] = [];
			for (const g of findChildren(gesturesNode, "gesture")) {
				gesturesList.push({
					id: g.attrs.id || "",
					animationId: parseInt(g.attrs.animationId || "0", 10),
				});
			}
			if (gesturesList.length > 0) entry.gestures = gesturesList;
		}

		result.push(entry);
	}

	return result;
}

// ── Metadata Helpers ────────────────────────────────────────────────

export function extractPartColors(visualizations: NitroVisualization[]): {
	color: string[];
} {
	const viz64 = visualizations.find((v) => v.size === 64);
	if (!viz64?.colors) return { color: [] };
	return { color: Object.keys(viz64.colors) };
}

export function computeDefaultDir(directions: number[]): number {
	if (directions.includes(2)) return 2;
	if (directions.includes(0)) return 0;
	return directions[0] || 0;
}
