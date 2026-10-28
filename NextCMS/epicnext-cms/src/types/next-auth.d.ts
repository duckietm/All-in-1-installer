import type { DefaultSession } from "next-auth";

declare module "next-auth" {
	interface Session {
		user: { id: string; rank: number } & DefaultSession["user"];
	}
}

declare module "next-auth/jwt" {
	interface JWT {
		rank?: number;
		jwtVersion?: number;
		jwtCheckedAt?: number;
		invalid?: boolean;
	}
}
