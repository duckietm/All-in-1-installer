"use client";
import { type RefObject, useEffect } from "react";
export function useFormErrorFocus(
	form: RefObject<HTMLFormElement | null>,
	errors: Record<string, string[]>,
	pending: boolean,
) {
	useEffect(() => {
		if (pending) return;
		for (const field of Object.keys(errors)) {
			const control = form.current?.elements.namedItem(field);
			if (control instanceof HTMLElement && !control.hasAttribute("disabled")) {
				control.focus();
				break;
			}
		}
	}, [form, errors, pending]);
}
export function FormFieldError({
	name,
	errors,
}: {
	name: string;
	errors: Record<string, string[]>;
}) {
	const messages = errors[name];
	return messages?.length ? (
		<p id={`error-${name}`} role="alert" className="text-sm text-destructive">
			{messages.join(" · ")}
		</p>
	) : null;
}
