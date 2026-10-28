import type { Metadata } from "next";
import { ContentCard } from "@/components/public/ui";

// Public API documentation. Static, hand-maintained from the routes that
// actually exist under src/app/api — keep this in sync when endpoints change.

export const metadata: Metadata = {
	title: "Developers",
	description: "Public API documentation for the hotel.",
	openGraph: {
		title: "Developers",
		description: "Public API documentation for the hotel.",
		type: "website",
	},
};

type Method = "GET" | "POST" | "DELETE";

type Endpoint = {
	method: Method;
	path: string;
	description: string;
	/** Requires `Authorization: Bearer <token>`. */
	bearer?: boolean;
	/** Requires a signed-in web session (NextAuth), not a Bearer token. */
	session?: boolean;
};

type Group = {
	icon: string;
	title: string;
	subtitle: string;
	endpoints: Endpoint[];
};

// Mirrors the route.ts files under src/app/api. Only documents endpoints that
// really exist; auth flags reflect bearerUserId() / auth() usage in each route.
const GROUPS: Group[] = [
	{
		icon: "👤",
		title: "Users",
		subtitle: "Profiles and the signed-in account.",
		endpoints: [
			{
				method: "GET",
				path: "/api/users/{username}",
				description:
					"Public profile for a user by username (look, motto, rank, badges).",
			},
			{
				method: "GET",
				path: "/api/me",
				description:
					"The currently signed-in user, or { user: null } when not authenticated.",
			},
		],
	},
	{
		icon: "📰",
		title: "Content",
		subtitle: "News articles, comments and photos.",
		endpoints: [
			{
				method: "GET",
				path: "/api/articles",
				description:
					"List published news articles (paginated via query params).",
			},
			{
				method: "GET",
				path: "/api/articles/{slug}",
				description: "A single article by slug, with its comments.",
			},
			{
				method: "POST",
				path: "/api/articles/{slug}/comment",
				description: "Post a comment on an article.",
				bearer: true,
			},
			{
				method: "GET",
				path: "/api/photos",
				description: "Recent in-game camera photos.",
			},
		],
	},
	{
		icon: "🏙️",
		title: "Community",
		subtitle: "Hotel population, guilds, staff and teams.",
		endpoints: [
			{
				method: "GET",
				path: "/api/home",
				description:
					"Aggregated home-page payload (settings, news, online stats).",
			},
			{
				method: "GET",
				path: "/api/online",
				description: "Users currently online.",
			},
			{
				method: "GET",
				path: "/api/online/count",
				description: "Just the online-user count.",
			},
			{
				method: "GET",
				path: "/api/leaderboard",
				description: "Player leaderboard (ranked by the requested metric).",
			},
			{
				method: "GET",
				path: "/api/guilds",
				description: "List guilds.",
			},
			{
				method: "GET",
				path: "/api/guilds/{id}",
				description: "A single guild with its members.",
			},
			{
				method: "GET",
				path: "/api/staff",
				description: "Staff members above the configured minimum rank.",
			},
			{
				method: "GET",
				path: "/api/teams",
				description: "Public staff teams / rank groups.",
			},
		],
	},
	{
		icon: "💰",
		title: "Economy",
		subtitle: "Shop catalogue and rare-furniture values.",
		endpoints: [
			{
				method: "GET",
				path: "/api/shop",
				description: "Shop products (filter by category via query params).",
			},
			{
				method: "GET",
				path: "/api/shop/categories",
				description: "Shop categories.",
			},
			{
				method: "GET",
				path: "/api/values",
				description: "Rare-value catalogue.",
			},
			{
				method: "GET",
				path: "/api/values/{id}",
				description: "A single rare value entry.",
			},
			{
				method: "GET",
				path: "/api/values/categories",
				description: "Rare-value categories.",
			},
		],
	},
	{
		icon: "📻",
		title: "Radio",
		subtitle: "Now-playing, listeners, DJ points and shouts.",
		endpoints: [
			{
				method: "GET",
				path: "/api/radio/now-playing",
				description: "The track currently on air.",
			},
			{
				method: "GET",
				path: "/api/radio/current-dj",
				description: "The DJ currently live.",
			},
			{
				method: "GET",
				path: "/api/radio/listeners",
				description: "Current listener count.",
			},
			{
				method: "GET",
				path: "/api/radio/config",
				description: "Public radio configuration.",
			},
			{
				method: "GET",
				path: "/api/radio/embed-config",
				description: "Configuration for the embeddable radio player.",
			},
			{
				method: "GET",
				path: "/api/radio/auto-play",
				description: "AutoDJ playback state.",
			},
			{
				method: "GET",
				path: "/api/radio/stream",
				description: "Stream metadata / proxy details.",
			},
			{
				method: "GET",
				path: "/api/radio/points/leaderboard",
				description: "DJ points leaderboard.",
			},
			{
				method: "GET",
				path: "/api/radio/points",
				description: "The signed-in user's own DJ points.",
				bearer: true,
			},
			{
				method: "GET",
				path: "/api/radio/shouts",
				description: "Recent radio shout-outs.",
			},
			{
				method: "POST",
				path: "/api/radio/shouts",
				description: "Submit a shout-out to the current DJ.",
				bearer: true,
			},
		],
	},
	{
		icon: "⚙️",
		title: "Settings",
		subtitle: "Public site configuration.",
		endpoints: [
			{
				method: "GET",
				path: "/api/settings",
				description:
					"Public, non-sensitive site settings (name, theme, links).",
			},
		],
	},
	{
		icon: "🔑",
		title: "Tokens",
		subtitle: "Issue and manage personal access tokens.",
		endpoints: [
			{
				method: "POST",
				path: "/api/tokens",
				description:
					"Mint a new personal access token (the plaintext is shown once).",
				session: true,
			},
			{
				method: "GET",
				path: "/api/me/tokens",
				description: "List your personal access tokens (id, name, last used).",
				session: true,
			},
			{
				method: "DELETE",
				path: "/api/me/tokens?id={id}",
				description: "Revoke one of your tokens by id.",
				session: true,
			},
		],
	},
	{
		icon: "🎫",
		title: "Tickets",
		subtitle: "Help-center tickets and replies.",
		endpoints: [
			{
				method: "GET",
				path: "/api/tickets",
				description: "List your own help-center tickets.",
				bearer: true,
			},
			{
				method: "POST",
				path: "/api/tickets",
				description: "Open a new help-center ticket.",
				bearer: true,
			},
			{
				method: "GET",
				path: "/api/tickets/{id}",
				description: "A single ticket you own, with its replies.",
				bearer: true,
			},
			{
				method: "POST",
				path: "/api/tickets/{id}/reply",
				description: "Reply to one of your tickets.",
				bearer: true,
			},
		],
	},
	{
		icon: "❤️",
		title: "Health",
		subtitle: "Service status.",
		endpoints: [
			{
				method: "GET",
				path: "/api/health",
				description: "Liveness probe — reports app and database status.",
			},
		],
	},
];

const METHOD_CLASS: Record<Method, string> = {
	GET: "bg-primary/20 text-[var(--color-text)]",
	POST: "bg-[var(--color-primary)]/18 text-[var(--color-text)]",
	DELETE: "bg-destructive/22 text-[var(--color-text)]",
};

function AuthTag({ endpoint }: { endpoint: Endpoint }) {
	if (endpoint.bearer) {
		return (
			<span
				className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--color-primary)]/18 text-[var(--color-text)]"
				title="Requires Authorization: Bearer <token>"
			>
				🔒 Bearer
			</span>
		);
	}
	if (endpoint.session) {
		return (
			<span
				className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--color-primary)]/18 text-[var(--color-text)]"
				title="Requires a signed-in web session"
			>
				🔒 Session
			</span>
		);
	}
	return (
		<span
			className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-[var(--color-text)]"
			title="No authentication required"
		>
			Public
		</span>
	);
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: "0.5rem 0.75rem",
				padding: "0.7rem 0",
				borderTop: "1px solid var(--border-subtle)",
			}}
		>
			<code
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "0.5rem",
					fontFamily:
						"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
					fontSize: "0.85rem",
					background:
						"color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--radius-sm)",
					padding: "0.3rem 0.55rem",
					whiteSpace: "nowrap",
					maxWidth: "100%",
					overflowX: "auto",
				}}
			>
				<span
					className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${METHOD_CLASS[endpoint.method]}`}
				>
					{endpoint.method}
				</span>
				<span>{endpoint.path}</span>
			</code>
			<span className="muted" style={{ flex: "1 1 14rem", minWidth: "12rem" }}>
				{endpoint.description}
			</span>
			<AuthTag endpoint={endpoint} />
		</div>
	);
}

export default function DevelopersPage() {
	const totalEndpoints = GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

	return (
		<section className="page-grid">
			<ContentCard
				icon="🧩"
				title="Developer API"
				subtitle={`A public REST API over the hotel — ${totalEndpoints} endpoints across ${GROUPS.length} groups.`}
			>
				<p className="muted" style={{ margin: 0 }}>
					All endpoints live under <code>/api</code> and return JSON. Most read
					endpoints are open; a handful that touch your account need a token.
					Browse the groups below — each row shows the method, path, what it
					does and whether it needs authentication.
				</p>
			</ContentCard>

			<ContentCard
				icon="🔐"
				title="Authentication"
				subtitle="How to call protected endpoints."
			>
				<div style={{ display: "grid", gap: "0.75rem" }}>
					<p className="muted" style={{ margin: 0 }}>
						Most reads are <strong>open</strong> and need no credentials.
						Endpoints marked{" "}
						<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--color-primary)]/18 text-[var(--color-text)]">
							🔒 Bearer
						</span>{" "}
						require a personal access token sent in the request header:
					</p>
					<code
						style={{
							display: "block",
							fontFamily:
								"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
							fontSize: "0.85rem",
							background:
								"color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--radius-sm)",
							padding: "0.6rem 0.75rem",
							whiteSpace: "pre-wrap",
							wordBreak: "break-all",
						}}
					>
						Authorization: Bearer &lt;your-token&gt;
					</code>
					<p className="muted" style={{ margin: 0 }}>
						To get a token, sign in to the website and <code>POST</code> to{" "}
						<code>/api/tokens</code> — the plaintext token is returned{" "}
						<strong>once</strong> and never shown again, so store it safely. You
						can list and revoke your tokens at <code>/api/me/tokens</code>.
						These token-management endpoints are marked{" "}
						<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--color-primary)]/18 text-[var(--color-text)]">
							🔒 Session
						</span>{" "}
						because they use your signed-in web session rather than a Bearer
						token.
					</p>
					<p className="muted" style={{ margin: 0 }}>
						Tokens are tied to your account: Bearer endpoints only ever return
						or modify your own data (your tickets, your shouts, your DJ points).
					</p>
				</div>
			</ContentCard>

			{GROUPS.map((group) => (
				<ContentCard
					key={group.title}
					icon={group.icon}
					title={group.title}
					subtitle={group.subtitle}
				>
					<div style={{ display: "grid" }}>
						{group.endpoints.map((endpoint) => (
							<EndpointRow
								key={`${endpoint.method} ${endpoint.path}`}
								endpoint={endpoint}
							/>
						))}
					</div>
				</ContentCard>
			))}
		</section>
	);
}
