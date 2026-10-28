export function isHousekeepingPreviewEnabled(input: {
	nodeEnv: "development" | "test" | "production";
	flag: boolean;
	hasProductionAccess?: boolean;
}): boolean {
	return (
		input.flag &&
		(input.nodeEnv !== "production" || input.hasProductionAccess === true)
	);
}
