export interface PaginatedResult<T> {
	rows: T[];
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
}

export interface ListParams {
	search: string;
	perPage: number;
	page: number;
	sort?: string;
	order?: "asc" | "desc";
}

export interface DataTableFilterOption {
	label: string;
	value: string;
}

export interface DataTableColumn<T> {
	key: (keyof T & string) | (string & {});
	label: string;
	sortable?: boolean;
	render?: (value: T[keyof T], row: T) => React.ReactNode;
	filterOptions?: DataTableFilterOption[];
	filterKey?: string;
}

export interface StatsCard {
	label: string;
	value: number | string;
	description?: string;
	icon?: React.ReactNode;
}

export interface BreadcrumbItem {
	label: string;
	href?: string;
}
