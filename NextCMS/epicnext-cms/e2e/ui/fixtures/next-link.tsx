import type { AnchorHTMLAttributes } from "react";
export default function FixtureLink({
	prefetch: _prefetch,
	...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
	return <a {...props} />;
}
