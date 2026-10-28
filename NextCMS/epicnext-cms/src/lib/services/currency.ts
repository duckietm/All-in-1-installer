// Numeric values are dictated by the Arcturus emulator and MUST NOT change.
export enum CurrencyType {
	Credits = -1,
	Duckets = 0,
	Diamonds = 5,
	Points = 101,
}

const LABELS: Record<CurrencyType, string> = {
	[CurrencyType.Credits]: "Credits",
	[CurrencyType.Duckets]: "Duckets",
	[CurrencyType.Diamonds]: "Diamonds",
	[CurrencyType.Points]: "Points",
};

export function currencyLabel(type: CurrencyType): string {
	// type is CurrencyType enum
	return LABELS[type];
}
