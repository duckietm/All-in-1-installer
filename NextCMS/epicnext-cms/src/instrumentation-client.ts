import { reportBrowserError } from "@/lib/browser-errors";

window.addEventListener("error", (event) => {
	if (event.error) reportBrowserError(event.error);
});
window.addEventListener("unhandledrejection", (event) =>
	reportBrowserError(event.reason, "browser.unhandled_rejection"),
);
