import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Map Radix-style `asChild` onto Base UI's `render` prop.
 * Generic over the render-prop type so component-specific Base UI render
 * signatures (e.g. `UseRenderRenderProp<ButtonState>`) are preserved.
 */
export function resolveAsChild<R = ReactElement | undefined>(
	asChild: boolean | undefined,
	children: ReactNode,
	render?: R,
): {
	render?: R;
	children: ReactNode;
} {
	if (render != null) return { render, children };
	if (asChild && isValidElement(children)) {
		return {
			render: children as R,
			children: (children.props as { children?: ReactNode }).children,
		};
	}
	return { children };
}
