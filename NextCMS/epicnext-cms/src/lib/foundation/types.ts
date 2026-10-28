declare const Brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [Brand]: B };

export type UserId = Branded<number, "UserId">;
export type RankId = Branded<number, "RankId">;
export type IpAddress = Branded<string, "IpAddress">;
export type RequestId = Branded<string, "RequestId">;

export interface SessionUser {
	id: UserId;
	username: string;
	rank: RankId;
	look: string;
	mail: string;
}

export interface AppSession {
	user: SessionUser;
	expires: string;
}

export interface ActionContext {
	session: AppSession;
	requestId: RequestId;
	ip: IpAddress;
}

export interface AdminActionContext extends ActionContext {
	permissions: PermissionSet;
}

export interface ActionSuccess<T = Record<string, unknown>> {
	ok: true;
	data?: T;
}
export interface ActionFailure {
	ok: false;
	error: string;
	fieldErrors?: Record<string, string[]>;
}
export type ActionResult<T = Record<string, unknown>> =
	| ActionSuccess<T>
	| ActionFailure;

export interface PaginatedQuery {
	page: number;
	perPage: number;
	sort?: string;
	order?: "asc" | "desc";
	search?: string;
}

export interface PaginatedResult<T> {
	rows: T[];
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
}

export interface PermissionSet {
	has(permission: string): boolean;
	hasAny(...permissions: string[]): boolean;
	hasAll(...permissions: string[]): boolean;
	isSuperAdmin: boolean;
}

export interface RequestContext {
	requestId: RequestId;
	ip: IpAddress;
	userId: UserId | null;
	startedAt: number;
}
