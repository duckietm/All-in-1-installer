"use client";

// import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type DEFAULT_NEW_ITEM, POINTS_TYPES } from "./types";

export interface AddItemFormFieldsProps {
	data: typeof DEFAULT_NEW_ITEM;
	onChange: (key: string, value: string | number) => void;
}

export function AddItemFormFields({ data, onChange }: AddItemFormFieldsProps) {
	return (
		<div className="space-y-3">
			<div className="space-y-2">
				<Label>Catalog Name</Label>
				<Input
					value={data.catalogName}
					onChange={(e) => onChange("catalogName", e.target.value)}
				/>
			</div>
			<div className="space-y-2">
				<Label>Item IDs (semicolon-separated)</Label>
				<Input
					value={data.itemIds}
					onChange={(e) => onChange("itemIds", e.target.value)}
				/>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Credits</Label>
					<Input
						type="number"
						value={data.costCredits}
						onChange={(e) =>
							onChange("costCredits", parseInt(e.target.value, 10) || 0)
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Points</Label>
					<Input
						type="number"
						value={data.costPoints}
						onChange={(e) =>
							onChange("costPoints", parseInt(e.target.value, 10) || 0)
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Points Type</Label>
					<Select
						value={String(data.pointsType)}
						onValueChange={(v) => onChange("pointsType", parseInt(v, 10))}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(POINTS_TYPES).map(([val, { label }]) => (
								<SelectItem key={val} value={val}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Amount</Label>
					<Input
						type="number"
						value={data.amount}
						onChange={(e) =>
							onChange("amount", parseInt(e.target.value, 10) || 1)
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Order</Label>
					<Input
						type="number"
						value={data.orderNumber}
						onChange={(e) =>
							onChange("orderNumber", parseInt(e.target.value, 10) || 0)
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Offer ID</Label>
					<Input
						type="number"
						value={data.offerId}
						onChange={(e) => onChange("offerId", parseInt(e.target.value, 10))}
					/>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Limited Sells</Label>
					<Input
						type="number"
						value={data.limitedSells}
						onChange={(e) =>
							onChange("limitedSells", parseInt(e.target.value, 10) || 0)
						}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Limited Stack</Label>
					<Input
						type="number"
						value={data.limitedStack}
						onChange={(e) =>
							onChange("limitedStack", parseInt(e.target.value, 10) || 0)
						}
					/>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Have Offer</Label>
					<Select
						value={data.haveOffer}
						onValueChange={(v) => onChange("haveOffer", v)}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1">Yes</SelectItem>
							<SelectItem value="0">No</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Club Only</Label>
					<Select
						value={data.clubOnly}
						onValueChange={(v) => onChange("clubOnly", v)}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="0">No</SelectItem>
							<SelectItem value="1">Yes</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="space-y-2">
				<Label>Extra Data</Label>
				<Input
					value={data.extradata}
					onChange={(e) => onChange("extradata", e.target.value)}
					placeholder="Optional extra data"
				/>
			</div>
		</div>
	);
}
