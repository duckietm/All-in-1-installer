import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { ContentCard, EmptyState, StatBlock } from "@/components/public/ui";
import { db, Rooms, User } from "@/lib/db";

// Arcturus stores room access as a short string on rooms.state. Map each known
// value to a friendly label + lock icon; unknown values fall back to the raw
// string so we never hide a real (future) state from the visitor.
const STATE_LABELS: Record<string, { label: string; icon: string }> = {
	open: { label: "Open", icon: "🔓" },
	locked: { label: "Locked (doorbell)", icon: "🔒" },
	password: { label: "Password", icon: "🔑" },
	invisible: { label: "Invisible", icon: "👻" },
};

function describeState(state: string): { label: string; icon: string } {
	// STATE_LABELS has known keys, fallback provided
	return STATE_LABELS[state] ?? { label: state || "Unknown", icon: "🚪" };
}

/** Parse a route id to a positive integer, or null when it isn't numeric. */
function parseRoomId(raw: string): number | null {
	if (!/^\d+$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function getRoom(raw: string) {
	const id = parseRoomId(raw);
	if (id === null) return null;
	const [room] = await db
		.select({
			id: Rooms.id,
			ownerId: Rooms.ownerId,
			ownerName: Rooms.ownerName,
			name: Rooms.name,
			description: Rooms.description,
			state: Rooms.state,
			users: Rooms.users,
			usersMax: Rooms.usersMax,
			category: Rooms.category,
			score: Rooms.score,
			tags: Rooms.tags,
		})
		.from(Rooms)
		.where(eq(Rooms.id, id))
		.limit(1)
		.catch(() => []);
	return room ?? null;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const room = await getRoom(id);
	if (!room) return { title: "Room" };
	return {
		title: room.name || `Room #${room.id}`,
		description:
			room.description || `Visit ${room.name || "this room"} in the hotel.`,
	};
}

export default async function RoomPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	// Guard non-numeric / absent ids before touching the DB.
	if (parseRoomId(id) === null) notFound();

	const room = await getRoom(id);
	if (!room) notFound();

	// Resolve the live owner username by id; fall back to the room's denormalised
	// owner_name column if the account row is missing or the query degrades.
	const owner =
		room.ownerId > 0
			? (
					await db
						.select({ username: User.username })
						.from(User)
						.where(eq(User.id, room.ownerId))
						.limit(1)
						.catch(() => [])
				)[0]
			: null;
	const ownerName = owner?.username || room.ownerName || "Unknown";

	const state = describeState(room.state);
	const tags = room.tags
		.split(/[,;\s]+/)
		.map((t) => t.trim())
		.filter(Boolean);

	return (
		<section className="page-grid">
			<p style={{ margin: 0 }}>
				<Link href="/" className="btn btn-outline">
					← Back to the hotel
				</Link>
			</p>

			<ContentCard
				icon="🚪"
				title={room.name || `Room #${room.id}`}
				subtitle={
					<>
						Owned by{" "}
						<Link href={`/u/${encodeURIComponent(ownerName)}`}>
							{ownerName}
						</Link>
					</>
				}
			>
				{room.description ? (
					<p style={{ margin: "0 0 1rem" }}>{room.description}</p>
				) : (
					<p className="muted" style={{ margin: "0 0 1rem" }}>
						This room has no description.
					</p>
				)}

				<div className="stat-grid">
					<StatBlock
						icon="👥"
						value={`${room.users.toLocaleString()} / ${room.usersMax.toLocaleString()}`}
						label="Users"
					/>
					<StatBlock icon={state.icon} value={state.label} label="Access" />
					<StatBlock
						icon="⭐"
						value={room.score.toLocaleString()}
						label="Rating"
					/>
					<StatBlock icon="🏷️" value={`#${room.category}`} label="Category" />
				</div>

				{tags.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "0.5rem",
							marginTop: "1rem",
						}}
					>
						{tags.map((tag) => (
							<span key={tag} className="online-badge">
								#{tag}
							</span>
						))}
					</div>
				) : null}
			</ContentCard>

			<ContentCard icon="ℹ️" title="About this room">
				<EmptyState icon="🎮">
					Enter the hotel to visit {room.name || `room #${room.id}`} in 3D.
				</EmptyState>
			</ContentCard>
		</section>
	);
}
