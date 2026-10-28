/**
 * Auto-detect furniture interaction capabilities from classname/name.
 * Determines: canSit, canLay, canStand, interactionType, clickLimit
 */

export interface AutoInteractionResult {
	canSit: boolean;
	canLay: boolean;
	canStand: boolean;
	interactionType: string;
	clickLimit: number;
	interactionModesCount: number;
	reason: string;
}

/**
 * Real interaction data that, when available, is used verbatim so detection
 * has zero false positives (no keyword guessing for known furniture).
 */
export interface RealInteractionData {
	cansiton?: boolean;
	canlayon?: boolean;
	canstandon?: boolean;
	logicType?: string;
	specialtype?: number;
	/** Real animation-state count from the .nitro asset. */
	animationStates?: number;
	/**
	 * True when the sit/lay/stand flags come from a curated source (official
	 * furnidata) or from SWF logic that actually contains <action> nodes.
	 * When false the flags were defaulted (asset had no action data at all),
	 * so keyword detection may still contribute.
	 */
	hasActionData?: boolean;
}

function realSitLayStand(
	classname: string,
	name?: string,
	real?: RealInteractionData,
): {
	canSit: boolean;
	canLay: boolean;
	canStand: boolean;
	usedReal: boolean;
} {
	// When real flags are present AND trustworthy (curated furnidata, or SWF
	// logic that actually declared <action> nodes), trust them completely —
	// keyword detection would only introduce false positives. All-false flags
	// without any action data mean "unknown", not "confirmed false".
	if (
		real &&
		(real.hasActionData === true ||
			real.cansiton === true ||
			real.canlayon === true ||
			real.canstandon === true)
	) {
		return {
			canSit: real.cansiton === true,
			canLay: real.canlayon === true,
			canStand: real.canstandon === true,
			usedReal: true,
		};
	}

	const normalizedClassname = normalizeString(classname);
	const normalizedName = name ? normalizeString(name) : "";
	const searchText = `${normalizedClassname} ${normalizedName}`;

	const sitMatch = findMatch(searchText, SIT_KEYWORDS);
	const layMatch = findMatch(searchText, LAY_KEYWORDS);
	const standMatch = findMatch(searchText, STAND_KEYWORDS);

	let canSit = false;
	let canLay = false;
	let canStand = false;
	if (layMatch) {
		canLay = true;
		canSit = true;
	} else if (sitMatch) {
		canSit = true;
	} else if (standMatch) {
		canStand = true;
	}
	return { canSit, canLay, canStand, usedReal: false };
}

export function autoDetectInteraction(
	classname: string,
	name?: string,
	real?: RealInteractionData,
): AutoInteractionResult {
	const normalizedClassname = normalizeString(classname);
	const normalizedName = name ? normalizeString(name) : "";

	const searchText = `${normalizedClassname} ${normalizedName}`;

	const sitMatch = findMatch(searchText, SIT_KEYWORDS);
	const layMatch = findMatch(searchText, LAY_KEYWORDS);
	const standMatch = findMatch(searchText, STAND_KEYWORDS);

	const { canSit, canLay, canStand, usedReal } = realSitLayStand(
		classname,
		name,
		real,
	);

	let matchedKeyword: string | null = null;
	let interactionType = "default";
	let clickLimit = 0;
	let interactionModesCount = 0;

	// Classname mechanics (dice/gate/teleport/…) are deterministic — detect
	// them regardless of whether real flags were trusted.
	const mechanicType = realMechanicType(classname);

	if (usedReal) {
		// interactionType: the classname mechanic wins when detectable (dice/gate/
		// teleport ship as generic furniture_multistate in .nitro, so logicType
		// alone cannot distinguish them), then the real logicType mapping.
		const keywordType =
			INTERACTION_TYPE_MAP[
				((layMatch ??
					sitMatch ??
					standMatch) as keyof typeof INTERACTION_TYPE_MAP) ?? ""
			];
		interactionType =
			mechanicType ??
			(real?.logicType && real.logicType !== "furniture_basic"
				? (mapLogicType(real.logicType) ?? "default")
				: (keywordType ?? "default"));
	} else if (layMatch) {
		matchedKeyword = layMatch;
		interactionType = INTERACTION_TYPE_MAP[layMatch] || "bed";
	} else if (sitMatch) {
		matchedKeyword = sitMatch;
		interactionType = INTERACTION_TYPE_MAP[sitMatch] || "chair";
	} else if (standMatch) {
		matchedKeyword = standMatch;
		interactionType = INTERACTION_TYPE_MAP[standMatch] || "default";
	}
	if (!usedReal && mechanicType) {
		interactionType = mechanicType;
	}

	// Modes count = how many states clicking cycles through. Priority:
	//   1. Emulator-fixed value per mechanic (dice = 6, gate/teleport = 2, …)
	//   2. Real animation-state count from the .nitro asset (renderable states)
	//   3. Sit/lay furniture without state info → 1
	//   4. Keyword default (chairs 1, tables 0) / plain items → 0
	const fixedModes = MECHANIC_MODES[interactionType];
	if (fixedModes !== undefined) {
		interactionModesCount = fixedModes;
	} else if (real?.animationStates !== undefined && real.animationStates > 1) {
		interactionModesCount = real.animationStates;
	} else if (canLay || canSit) {
		interactionModesCount = 1;
	} else if (matchedKeyword) {
		interactionModesCount = INTERACTION_MODES[matchedKeyword] ?? 0;
	} else {
		interactionModesCount = 0;
	}
	clickLimit =
		fixedModes !== undefined
			? 1
			: canLay || canSit || canStand
				? 1
				: matchedKeyword
					? (CLICK_LIMITS[matchedKeyword] ?? 0)
					: 0;

	const reasonParts: string[] = [];
	if (usedReal) {
		reasonParts.push("Real furniture data");
	} else if (matchedKeyword) {
		reasonParts.push(`Matched "${matchedKeyword}"`);
	}
	if (canSit) reasonParts.push("can sit");
	if (canLay) reasonParts.push("can lay");
	if (canStand) reasonParts.push("can stand");
	if (!matchedKeyword && !usedReal) {
		reasonParts.push("No keywords matched - default");
	}

	return {
		canSit,
		canLay,
		canStand,
		interactionType,
		clickLimit,
		interactionModesCount,
		reason: reasonParts.join(" · "),
	};
}

function mapLogicType(logicType: string): string | null {
	const lt = logicType.toLowerCase();
	if (lt.includes("multistate")) return "default";
	if (lt.includes("gate")) return "gate";
	if (lt.includes("teleport")) return "teleport";
	if (lt.includes("roller")) return "roller";
	if (lt.includes("dice")) return "dice";
	if (lt.includes("vendingmachine")) return "vendingmachine";
	if (lt.includes("firework")) return "fireworks";
	if (lt.includes("trophy")) return "trophy";
	if (lt.includes("exchange")) return "exchange";
	if (lt.includes("habbowheel")) return "habbowheel";
	if (lt.includes("soundmachine")) return "jukebox";
	if (lt.includes("badge")) return "badge";
	return null;
}

/**
 * Detect a mechanics interaction type from the classname itself. Used when
 * the .nitro logicType is generic (e.g. dice/gate bundles ship as
 * furniture_multistate) so state-based modes are computed correctly.
 */
function realMechanicType(classname: string): string | null {
	const c = classname.toLowerCase();
	if (/(^|_)dice/.test(c)) return "dice";
	if (c.includes("teleport")) return "teleport";
	if (c.includes("gate")) return "gate";
	if (c.includes("roller")) return "roller";
	if (c.includes("vending")) return "vendingmachine";
	if (c.includes("firework")) return "fireworks";
	if (c.includes("trophy")) return "trophy";
	if (c.includes("exchange")) return "exchange";
	if (c.includes("habbowheel")) return "habbowheel";
	if (c.includes("jukebox") || c.includes("soundmachine")) return "jukebox";
	return null;
}

/** Emulator-fixed interaction_modes_count per mechanic. */
const MECHANIC_MODES: Record<string, number> = {
	dice: 6,
	gate: 2,
	teleport: 2,
	roller: 1,
	vendingmachine: 1,
	fireworks: 1,
	trophy: 1,
	exchange: 1,
	habbowheel: 1,
	jukebox: 1,
};

/**
 * Derive the real interaction modes count from a parsed Nitro JSON asset.
 * The number of distinct animation states on the first visualization is the
 * authoritative "modes" value (e.g. dice = 6, gate = 2, multistate = N).
 * Returns undefined when the asset has no usable animation states.
 * Pure (no fs/server deps) so the nitro editor client can use it too.
 */
export function nitroAnimationStatesCount(
	nitroJson: Record<string, unknown> | null | undefined,
): number | undefined {
	if (!nitroJson || typeof nitroJson !== "object") return undefined;
	const visualizations = (nitroJson as { visualizations?: unknown })
		.visualizations;
	if (!Array.isArray(visualizations)) return undefined;
	for (const vis of visualizations) {
		if (!vis || typeof vis !== "object") continue;
		const animations = (vis as { animations?: unknown }).animations;
		if (animations && typeof animations === "object") {
			const keys = Object.keys(animations as Record<string, unknown>);
			// Skip purely decorative states (jukebox tracks 100+, hidden -1).
			const real = keys.filter((k) => {
				const n = Number(k);
				return Number.isInteger(n) && n >= 0 && n < 100;
			});
			if (real.length > 1) return real.length;
		}
	}
	return undefined;
}

const SIT_KEYWORDS = [
	"bench",
	"bank",
	"sofa",
	"couch",
	"chair",
	"stool",
	"seat",
	"armchair",
	"loveseat",
	"settee",
	"ottoman",
	"pouf",
	"beanbag",
	"bean_bag",
	"rocking",
	"swing",
	"hammock",
	"throne",
	"wheelchair",
	"toilet",
	"potty",
	// French
	"chaise",
	"banquette",
	"tabouret",
	"fauteuil",
	"canap",
	"banc",
	// Dutch
	"stoel",
	"kruk",
	// Spanish
	"silla",
	"taburete",
	// Italian
	"sedia",
	"poltrona",
	// German
	"stuhl",
	"sessel",
	"hocker",
];

const LAY_KEYWORDS = [
	"bed",
	"mattress",
	"futon",
	"bunk",
	"cot",
	"hammock",
	"sleeping",
	"bedroll",
	"blanket",
	"pillow",
	"cushion",
	"lounger",
	"sunbed",
	"daybed",
	"divan",
	"waterbed",
	// French
	"matelas",
	"couette",
	// Dutch
	"bedden",
	// Spanish
	"cama",
	// Italian
	"letto",
	// German
	"bett",
];

const STAND_KEYWORDS = [
	"table",
	"desk",
	"counter",
	"bar",
	"shelf",
	"cabinet",
	"wardrobe",
	"dresser",
	"bookcase",
	"rack",
	"stand",
	"pedestal",
	"platform",
	"stage",
	"floor",
	"tile",
	"carpet",
	"rug",
	"path",
	"road",
	"grass",
	"dirt",
	"sand",
	"snow",
	"ice",
	"water",
	"pool",
	"fountain",
	// French
	"tafel",
	"bureau",
	"etagere",
	// Spanish / Italian
	"mesa",
	"tavolo",
	// German
	"schrank",
	"kommode",
];

const INTERACTION_TYPE_MAP: Record<string, string> = {
	bench: "bench",
	bank: "bench",
	sofa: "sofa",
	couch: "sofa",
	chair: "chair",
	stool: "stool",
	seat: "chair",
	armchair: "armchair",
	loveseat: "sofa",
	settee: "sofa",
	ottoman: "ottoman",
	pouf: "ottoman",
	beanbag: "beanbag",
	rocking: "rocking_chair",
	swing: "swing",
	hammock: "hammock",
	throne: "throne",
	wheelchair: "wheelchair",
	toilet: "toilet",
	potty: "toilet",
	bed: "bed",
	mattress: "bed",
	futon: "bed",
	bunk: "bunkbed",
	cot: "bed",
	sleeping: "bed",
	bedroll: "bed",
	blanket: "bed",
	pillow: "bed",
	cushion: "bed",
	lounger: "lounger",
	sunbed: "sunbed",
	daybed: "daybed",
	divan: "divan",
	waterbed: "waterbed",
	matelas: "bed",
	couette: "bed",
	bedden: "bed",
	cama: "bed",
	letto: "bed",
	bett: "bed",
	chaise: "chair",
	banquette: "bench",
	tabouret: "stool",
	fauteuil: "armchair",
	canap: "sofa",
	banc: "bench",
	stoel: "chair",
	kruk: "stool",
	silla: "chair",
	taburete: "stool",
	sedia: "chair",
	poltrona: "armchair",
	stuhl: "chair",
	sessel: "armchair",
	hocker: "stool",
	table: "table",
	desk: "desk",
	counter: "counter",
	bar: "bar",
	shelf: "shelf",
	cabinet: "cabinet",
	wardrobe: "wardrobe",
	dresser: "dresser",
	bookcase: "bookcase",
	rack: "rack",
	stand: "stand",
	pedestal: "pedestal",
	platform: "platform",
	stage: "stage",
	tafel: "table",
	bureau: "desk",
	etagere: "shelf",
	mesa: "table",
	tavolo: "table",
	schrank: "wardrobe",
	kommode: "dresser",
};

const INTERACTION_MODES: Record<string, number> = {
	bench: 1,
	bank: 1,
	sofa: 1,
	couch: 1,
	chair: 1,
	stool: 1,
	seat: 1,
	armchair: 1,
	loveseat: 1,
	settee: 1,
	ottoman: 1,
	pouf: 1,
	beanbag: 1,
	rocking: 1,
	swing: 1,
	hammock: 1,
	throne: 1,
	wheelchair: 1,
	toilet: 1,
	potty: 1,
	bed: 1,
	mattress: 1,
	futon: 1,
	bunk: 1,
	cot: 1,
	sleeping: 1,
	bedroll: 1,
	blanket: 1,
	pillow: 1,
	cushion: 1,
	lounger: 1,
	sunbed: 1,
	daybed: 1,
	divan: 1,
	waterbed: 1,
	matelas: 1,
	couette: 1,
	bedden: 1,
	cama: 1,
	letto: 1,
	bett: 1,
	chaise: 1,
	banquette: 1,
	tabouret: 1,
	fauteuil: 1,
	canap: 1,
	banc: 1,
	stoel: 1,
	kruk: 1,
	silla: 1,
	taburete: 1,
	sedia: 1,
	poltrona: 1,
	stuhl: 1,
	sessel: 1,
	hocker: 1,
	table: 0,
	desk: 0,
	counter: 0,
	bar: 0,
	shelf: 0,
	cabinet: 0,
	wardrobe: 0,
	dresser: 0,
	bookcase: 0,
	rack: 0,
	stand: 0,
	pedestal: 0,
	platform: 0,
	stage: 0,
	floor: 0,
	tile: 0,
	carpet: 0,
	rug: 0,
	path: 0,
	road: 0,
	grass: 0,
	dirt: 0,
	sand: 0,
	snow: 0,
	ice: 0,
	water: 0,
	pool: 0,
	fountain: 0,
	tafel: 0,
	bureau: 0,
	etagere: 0,
	mesa: 0,
	tavolo: 0,
	schrank: 0,
	kommode: 0,
};

const CLICK_LIMITS: Record<string, number> = {
	bench: 1,
	bank: 1,
	sofa: 1,
	couch: 1,
	chair: 1,
	stool: 1,
	seat: 1,
	armchair: 1,
	loveseat: 1,
	settee: 1,
	ottoman: 1,
	pouf: 1,
	beanbag: 1,
	rocking: 1,
	swing: 1,
	hammock: 1,
	throne: 1,
	wheelchair: 1,
	toilet: 1,
	potty: 1,
	bed: 1,
	mattress: 1,
	futon: 1,
	bunk: 1,
	cot: 1,
	sleeping: 1,
	bedroll: 1,
	blanket: 1,
	pillow: 1,
	cushion: 1,
	lounger: 1,
	sunbed: 1,
	daybed: 1,
	divan: 1,
	waterbed: 1,
	matelas: 1,
	couette: 1,
	bedden: 1,
	cama: 1,
	letto: 1,
	bett: 1,
	chaise: 1,
	banquette: 1,
	tabouret: 1,
	fauteuil: 1,
	canap: 1,
	banc: 1,
	stoel: 1,
	kruk: 1,
	silla: 1,
	taburete: 1,
	sedia: 1,
	poltrona: 1,
	stuhl: 1,
	sessel: 1,
	hocker: 1,
	table: 0,
	desk: 0,
	counter: 0,
	bar: 0,
	shelf: 0,
	cabinet: 0,
	wardrobe: 0,
	dresser: 0,
	bookcase: 0,
	rack: 0,
	stand: 0,
	pedestal: 0,
	platform: 0,
	stage: 0,
	floor: 0,
	tile: 0,
	carpet: 0,
	rug: 0,
	path: 0,
	road: 0,
	grass: 0,
	dirt: 0,
	sand: 0,
	snow: 0,
	ice: 0,
	water: 0,
	pool: 0,
	fountain: 0,
	tafel: 0,
	bureau: 0,
	etagere: 0,
	mesa: 0,
	tavolo: 0,
	schrank: 0,
	kommode: 0,
};

function normalizeString(str: string): string {
	return str.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function findMatch(normalized: string, keywords: string[]): string | null {
	for (const kw of keywords) {
		if (!normalized.includes(kw)) continue;
		// Short keywords (e.g. "bed", "lit", "bar") must match on token
		// boundaries so "bedside_table" or "split" don't false-positive.
		if (kw.length < 5) {
			const boundary = new RegExp(`(^|_)${kw}(_|$)`);
			if (!boundary.test(normalized)) continue;
		}
		return kw;
	}
	return null;
}

export function getInteractionTypeLabel(type: string): string {
	const labels: Record<string, string> = {
		bench: "Bench / Bank",
		sofa: "Sofa / Couch",
		chair: "Chair",
		stool: "Stool",
		armchair: "Armchair",
		ottoman: "Ottoman / Pouf",
		beanbag: "Bean Bag",
		rocking_chair: "Rocking Chair",
		swing: "Swing",
		hammock: "Hammock",
		throne: "Throne",
		wheelchair: "Wheelchair",
		toilet: "Toilet",
		bed: "Bed",
		bunkbed: "Bunk Bed",
		lounger: "Lounger / Sunbed",
		daybed: "Daybed",
		divan: "Divan",
		waterbed: "Waterbed",
		table: "Table",
		desk: "Desk",
		counter: "Counter",
		bar: "Bar",
		shelf: "Shelf",
		cabinet: "Cabinet",
		wardrobe: "Wardrobe",
		dresser: "Dresser",
		bookcase: "Bookcase",
		rack: "Rack",
		stand: "Stand",
		pedestal: "Pedestal",
		platform: "Platform",
		stage: "Stage",
		default: "Default (no interaction)",
	};
	return labels[type] || type;
}
