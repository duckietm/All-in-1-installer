import { useState } from "react";
import { PrefixDialog } from "@/app/admin/prefixes/prefix-dialog";
import {
	confirmUnsavedNavigation,
	useUnsavedChanges,
} from "@/hooks/use-unsaved-changes";
export function UnsavedHarness() {
	const [value, setValue] = useState("");
	const [open, setOpen] = useState(false);
	const [failSave, setFailSave] = useState(false);
	const [saved, setSaved] = useState(false);
	const [navigated, setNavigated] = useState(false);
	const guard = useUnsavedChanges(value !== "", "Discard unsaved changes?");
	return (
		<>
			<label>
				Working value
				<input
					aria-label="Working value"
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
			</label>
			<a href="/admin/unsaved-destination">Leave editor</a>
			<a href="#same-page">Same page</a>
			<a href="mailto:staff@example.test">Email</a>
			<button
				type="button"
				onClick={() => {
					if (confirmUnsavedNavigation()) setNavigated(true);
				}}
			>
				Programmatic navigation
			</button>
			<button
				type="button"
				onClick={() => {
					guard.markSaved();
					setValue("");
					setSaved(true);
				}}
			>
				Save working value
			</button>
			{saved && <p>Working value saved</p>}
			{navigated && <p>Navigation allowed</p>}
			<button type="button" onClick={() => setOpen(true)}>
				Open prefix
			</button>
			<label>
				<input
					type="checkbox"
					checked={failSave}
					onChange={(event) => setFailSave(event.target.checked)}
				/>
				Fail prefix save
			</label>
			<PrefixDialog
				isOpen={open}
				onClose={() => setOpen(false)}
				editPrefix={null}
				onSave={async () => {
					if (failSave) return false;
					setSaved(true);
					return true;
				}}
			/>
		</>
	);
}
