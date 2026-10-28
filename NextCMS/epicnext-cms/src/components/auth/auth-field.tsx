"use client";

import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";

const ICON_CLASS =
	"pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2";

export interface AuthFieldProps {
	id: string;
	name: string;
	label: string;
	icon: LucideIcon;
	type?: string;
	/** Controlled value; omit both `value` and `onChange` for an uncontrolled field. */
	value?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
	autoComplete?: string;
	inputMode?:
		| "none"
		| "text"
		| "tel"
		| "url"
		| "email"
		| "numeric"
		| "decimal"
		| "search";
	required?: boolean;
	disabled?: boolean;
	minLength?: number;
	maxLength?: number;
	/** Marks the field with `aria-invalid` and a danger border. */
	invalid?: boolean;
	/** id of the element describing this field (e.g. an error banner). */
	describedBy?: string;
	iconColor?: string;
	inputStyle?: CSSProperties;
	/** Absolutely positioned control inside the input, e.g. `PasswordToggle`. */
	trailing?: ReactNode;
	/** Content rendered below the field: strength meter, policy hints, mismatch. */
	children?: ReactNode;
	/** Extra classes on the wrapping `space-y` container. */
	className?: string;
	inputRef?: Ref<HTMLInputElement>;
}

/**
 * One labelled, icon-prefixed auth input. Login and register repeat this markup
 * seven times; centralising it keeps the icon, focus and `aria-describedby`
 * behaviour identical everywhere.
 */
export function AuthField({
	id,
	name,
	label,
	icon: Icon,
	type = "text",
	value,
	onChange,
	placeholder,
	autoComplete,
	inputMode,
	required,
	disabled,
	minLength,
	maxLength,
	invalid,
	describedBy,
	iconColor = "var(--color-text-muted)",
	inputStyle,
	trailing,
	children,
	className = "",
	inputRef,
}: AuthFieldProps) {
	return (
		<div className={`space-y-1.5 ${className}`}>
			<label htmlFor={id} className="auth-label">
				{label}
			</label>
			<div className="relative">
				<Icon
					aria-hidden="true"
					className={ICON_CLASS}
					style={{ color: iconColor }}
				/>
				<input
					ref={inputRef}
					id={id}
					name={name}
					type={type}
					value={value}
					onChange={onChange ? (e) => onChange(e.target.value) : undefined}
					placeholder={placeholder}
					autoComplete={autoComplete}
					inputMode={inputMode}
					required={required}
					disabled={disabled}
					minLength={minLength}
					maxLength={maxLength}
					aria-invalid={invalid ? true : undefined}
					aria-describedby={describedBy}
					className={`auth-input has-icon ${trailing ? "has-action" : ""}`}
					style={inputStyle}
				/>
				{trailing}
			</div>
			{children}
		</div>
	);
}
