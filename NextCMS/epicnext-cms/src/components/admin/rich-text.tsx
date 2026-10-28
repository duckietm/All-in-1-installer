"use client";

import { useEffect, useId, useRef, useState } from "react";

// Editor assets are pinned in the lockfile and copied during build.
const TINYMCE_SRC = "/vendor/tinymce/tinymce.min.js";

type TinyMCEGlobal = {
	init: (opts: Record<string, unknown>) => Promise<unknown>;
	remove: (selector: string) => void;
};

declare global {
	interface Window {
		tinymce?: TinyMCEGlobal;
	}
}

let loaderPromise: Promise<TinyMCEGlobal | null> | null = null;

/** Inject the TinyMCE script once; resolves null if it fails to load. */
function loadTinyMce(): Promise<TinyMCEGlobal | null> {
	if (typeof window === "undefined") return Promise.resolve(null);
	if (window.tinymce) return Promise.resolve(window.tinymce);
	if (loaderPromise) return loaderPromise;

	loaderPromise = new Promise((resolve) => {
		const existing = document.querySelector<HTMLScriptElement>(
			"script[data-tinymce]",
		);
		const finish = () => resolve(window.tinymce ?? null);
		if (existing) {
			existing.addEventListener("load", finish, { once: true });
			existing.addEventListener("error", () => resolve(null), { once: true });
			if (window.tinymce) resolve(window.tinymce);
			return;
		}
		const script = document.createElement("script");
		script.src = TINYMCE_SRC;
		script.async = true;
		script.referrerPolicy = "origin";
		script.dataset.tinymce = "1";
		script.addEventListener("load", finish, { once: true });
		script.addEventListener("error", () => resolve(null), { once: true });
		document.head.appendChild(script);
	});
	return loaderPromise;
}

/**
 * WYSIWYG editor over a plain <textarea>. Keeps the original `name` so the
 * surrounding server-action form still receives the HTML on submit. If TinyMCE
 * fails to load (offline, CDN blocked) it silently degrades to the textarea.
 */
export function RichText({
	name,
	defaultValue = "",
	placeholder,
	ariaLabel,
	rows = 10,
	onChange,
}: {
	name: string;
	defaultValue?: string;
	placeholder?: string;
	ariaLabel?: string;
	rows?: number;
	onChange?: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const changeCallback = useRef(onChange);
	changeCallback.current = onChange;
	const reactId = useId();
	// Stable, querySelector-safe id (useId() contains ':').
	const editorId = `rt-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const selector = `#${editorId}`;

		loadTinyMce().then((tinymce) => {
			if (cancelled || !tinymce || !textareaRef.current) return;
			tinymce
				.init({
					selector,
					menubar: false,
					iframe_attrs: { title: ariaLabel || name },
					height: Math.max(rows * 22, 240),
					plugins: "link lists code autolink",
					toolbar:
						"undo redo | bold italic underline | bullist numlist | link | removeformat | code",
					branding: false,
					promotion: false,
					license_key: "gpl",
					skin: "oxide",
					content_style: "body{font-family:inherit;font-size:14px}",
					// Mirror typed HTML back into the underlying textarea so the form
					// submit (server action) always sees the current value.
					setup: (editor: {
						on: (ev: string, cb: () => void) => void;
						getContent: () => string;
					}) => {
						const sync = (notify: boolean) => {
							const field = textareaRef.current;
							if (!field) return;
							const html = editor.getContent();
							const changed = field.value !== html;
							field.value = html;
							if (notify && changed) changeCallback.current?.();
						};
						editor.on("SetContent", () => sync(false));
						editor.on("change keyup undo redo", () => sync(true));
					},
				})
				.then(() => {
					if (!cancelled) setReady(true);
				})
				.catch(() => {
					/* leave the plain textarea in place */
				});
		});

		return () => {
			cancelled = true;
			// Detach the editor instance on unmount; ignore if TinyMCE never loaded.
			try {
				window.tinymce?.remove(selector);
			} catch {
				/* noop */
			}
		};
	}, [editorId, rows, ariaLabel, name]);

	return (
		<textarea
			id={editorId}
			ref={textareaRef}
			name={name}
			aria-label={ariaLabel || name}
			defaultValue={defaultValue}
			placeholder={placeholder}
			rows={rows}
			// Hide the raw textarea only once TinyMCE has mounted (it replaces it with
			// its own iframe); until then the plain field is the visible fallback.
			style={ready ? { display: "none" } : undefined}
		/>
	);
}
