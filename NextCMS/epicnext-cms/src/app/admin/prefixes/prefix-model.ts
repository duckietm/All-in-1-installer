export interface UserPrefix {
	id: number;
	user_id: number;
	text: string;
	color: string;
	icon: string;
	effect: string;
	active: boolean;
	created_at: string;
	username?: string;
}

export interface BlacklistWord {
	id: number;
	word: string;
	created_at: string;
}

export interface PrefixSettings {
	max_length: string;
	min_rank_to_buy: string;
	price_credits: string;
	price_points: string;
	points_type: string;
}

export interface PrefixFormData {
	username: string;
	text: string;
	color: string;
	icon: string;
	effect: string;
	active: boolean;
}

export const PRESET_EFFECTS = [
	{ id: "", label: "None" },
	{ id: "glow", label: "✨ Glow" },
	{ id: "shadow", label: "🌑 Shadow" },
	{ id: "italic", label: "𝑰 Italic" },
	{ id: "outline", label: "🔲 Outline" },
	{ id: "pulse", label: "💫 Pulse" },
	{ id: "bold-glow", label: "💡 Neon" },
];

export const PRESET_ICONS = [
	{ emoji: "", label: "None" },
	{ emoji: "👑", label: "Crown" },
	{ emoji: "⭐", label: "Star" },
	{ emoji: "❤️", label: "Heart" },
	{ emoji: "💎", label: "Diamond" },
	{ emoji: "🔥", label: "Fire" },
	{ emoji: "⚡", label: "Lightning" },
	{ emoji: "🛡️", label: "Shield" },
	{ emoji: "💀", label: "Skull" },
	{ emoji: "🎵", label: "Music" },
	{ emoji: "💠", label: "Gem" },
	{ emoji: "⚔️", label: "Swords" },
	{ emoji: "🏆", label: "Trophy" },
	{ emoji: "🚀", label: "Rocket" },
	{ emoji: "👻", label: "Ghost" },
	{ emoji: "🐾", label: "Paw" },
	{ emoji: "🍃", label: "Leaf" },
	{ emoji: "😎", label: "Cool" },
	{ emoji: "🐺", label: "Wolf" },
	{ emoji: "🦁", label: "Lion" },
	{ emoji: "🐉", label: "Dragon" },
	{ emoji: "🦄", label: "Unicorn" },
	{ emoji: "🌙", label: "Moon" },
	{ emoji: "☀️", label: "Sun" },
	{ emoji: "❄️", label: "Snow" },
	{ emoji: "🌹", label: "Rose" },
	{ emoji: "🎮", label: "Controller" },
	{ emoji: "💰", label: "Money" },
	{ emoji: "🔮", label: "Orb" },
	{ emoji: "🏴‍☠️", label: "Pirate" },
];
