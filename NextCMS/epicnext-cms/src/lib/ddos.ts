export type DdosCategory = "pages" | "api" | "auth";

/**
 * Bucket a request path for rate limiting. Everything under `/cms_api/` that is not
 * an auth route counts as `api` — including `/cms_api/imaging/*` (avatars, badges).
 * That is intentional: imaging is a deliberate high-volume, cacheable surface,
 * so it gets the wider api budget rather than the page budget. The bare
 * `/imaging` renderer path never reaches this gate (it is excluded by the proxy
 * matcher and, in production, fronted by the edge proxy directly).
 */
export function classifyDdos(pathname: string): DdosCategory {
	if (
		pathname === "/cms_api/auth" ||
		pathname.startsWith("/cms_api/auth/") ||
		pathname === "/login" ||
		pathname.startsWith("/login/") ||
		pathname === "/register" ||
		pathname.startsWith("/register/") ||
		pathname === "/admin" ||
		pathname.startsWith("/admin/")
	) {
		return "auth";
	}
	if (pathname.startsWith("/cms_api/")) return "api";
	return "pages";
}

const HOSTILE_PATH_SEGMENTS = new Set([
	"wp-admin",
	"wp-login.php",
	"wp-includes",
	"phpmyadmin",
	"pma",
	"adminer",
	"server-status",
	".env",
	".git",
	"cmd.exe", // Windows command execution
	"shell", // Generic web shell indicator
	"jndi", // Log4j exploit attempts
	"tomcat", // Tomcat exploitation attempts
	"web-inf", // Java web app directory exposure
	"passwd", // Linux password file attempts
	"etc", // Linux configuration directory traversal
]);

const HOSTILE_PATH_EXTENSIONS = [
	".php",
	".asp",
	".aspx",
	".jsp",
	".cgi",
	".env", // Direct .env file access
	".bak", // Backup files
	".sql", // Database dumps
	".zip", // Archives that may contain sensitive data
	".rar", // Archives that may contain sensitive data
	".7z", // Archives that may contain sensitive data
	".txt", // Generic text files that might contain sensitive data
];

/**
 * Cheap scanner/exploit triage. These paths are never routes in this app, so a
 * hit is almost certainly an automated attack sweep; dropping it here costs no
 * Redis work and never affects genuine traffic.
 */
export function isSuspiciousPath(pathname: string): boolean {
	const lower = pathname.toLowerCase();
	for (const segment of lower.split("/")) {
		if (HOSTILE_PATH_SEGMENTS.has(segment)) return true;
	}
	for (const extension of HOSTILE_PATH_EXTENSIONS) {
		if (
			lower.endsWith(extension) ||
			lower.includes(`${extension}/`) ||
			lower.includes(`${extension}?`)
		) {
			return true;
		}
	}
	return false;
}
