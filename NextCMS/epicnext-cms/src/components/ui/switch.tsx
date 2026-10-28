"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import styles from "./switch.module.css";

function Switch({
	className,
	size = "default",
	...props
}: SwitchPrimitive.Root.Props & {
	size?: "sm" | "default";
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(styles.root, className)}
			{...props}
		>
			<SwitchPrimitive.Thumb data-slot="switch-thumb" className={styles.thumb}>
				<CheckIcon aria-hidden className={styles.check} />
			</SwitchPrimitive.Thumb>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
