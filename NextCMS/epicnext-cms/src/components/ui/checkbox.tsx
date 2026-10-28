"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative size-4 shrink-0 rounded-[4px] border shadow-xs outline-none transition-colors",
				"border-input bg-background text-transparent",
				"hover:border-primary/60",
				"data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
				"data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex size-full items-center justify-center text-current"
				keepMounted={false}
			>
				<CheckIcon className="size-3 stroke-[3]" aria-hidden />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
