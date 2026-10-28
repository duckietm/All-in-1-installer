/**
 * Drifting cloud puffs that float across the public background.
 * Pure decoration: fixed, behind the content, no pointer events.
 */
export function CloudsField() {
	return (
		<div className="clouds" aria-hidden="true">
			<span className="cloud cloud-1" />
			<span className="cloud cloud-2" />
			<span className="cloud cloud-3" />
			<span className="cloud cloud-4" />
			<span className="cloud cloud-5" />
			<span className="cloud cloud-6" />
			<span className="cloud cloud-7" />
			<span className="cloud cloud-8" />
		</div>
	);
}
