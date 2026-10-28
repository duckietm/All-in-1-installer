(() => {
	function parseHex(value) {
		const trimmed = String(value || "").trim();
		const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
		if (short) {
			const [r, g, b] = short[1].split("");
			return [
				Number.parseInt(r + r, 16),
				Number.parseInt(g + g, 16),
				Number.parseInt(b + b, 16),
			];
		}
		const match = /^#([0-9a-f]{6})$/i.exec(trimmed);
		if (!match) return null;
		return [
			Number.parseInt(match[1].slice(0, 2), 16),
			Number.parseInt(match[1].slice(2, 4), 16),
			Number.parseInt(match[1].slice(4, 6), 16),
		];
	}

	function relativeLuminance(rgb) {
		const channels = rgb.map((channel) => {
			const value = channel / 255;
			return value <= 0.04045
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	}

	function contrastRatio(foreground, background) {
		const fg = parseHex(foreground);
		const bg = parseHex(background);
		if (!fg || !bg) return null;
		const light = Math.max(relativeLuminance(fg), relativeLuminance(bg));
		const dark = Math.min(relativeLuminance(fg), relativeLuminance(bg));
		return (light + 0.05) / (dark + 0.05);
	}

	function readableColor(preferred, background) {
		const preferredRatio = contrastRatio(preferred, background);
		if (preferredRatio != null && preferredRatio >= 4.5) return preferred;
		const black = contrastRatio("#000000", background) ?? 0;
		const white = contrastRatio("#ffffff", background) ?? 0;
		return white >= black ? "#ffffff" : "#000000";
	}

	function applyNavbarColors(navbarColor, navbarTextColor) {
		const root = document.documentElement.style;
		if (navbarColor) root.setProperty("--color-navbar", navbarColor);
		const text =
			navbarTextColor ||
			(navbarColor ? readableColor("#1e293b", navbarColor) : null);
		if (text) {
			root.setProperty("--color-navbar-text", text);
			root.setProperty("--color-navbar-text-readable", text);
		} else if (navbarColor) {
			const readable = readableColor("#ffffff", navbarColor);
			root.setProperty("--color-navbar-text-readable", readable);
		}
	}

	let theme = null;
	let defaultDark = false;
	let navbarColor = null;
	let navbarTextColor = null;
	try {
		theme = localStorage.getItem("theme");
		const dd = document.querySelector('meta[name="theme-default-dark"]');
		defaultDark = dd ? dd.getAttribute("content") === "true" : false;
		navbarColor = localStorage.getItem("navbarColor");
		navbarTextColor = localStorage.getItem("navbarTextColor");
	} catch (_e) {}
	if (theme === "dark" || (!theme && defaultDark))
		document.documentElement.classList.add("dark");
	applyNavbarColors(navbarColor, navbarTextColor);
})();
