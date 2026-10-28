interface RankData {
	id: number;
	rank_name: string;
	badge: string;
	level: number;
	prefix: string;
	prefix_color: string;
	hidden_rank: string;
	log_commands: string;
	room_effect: number;
	auto_credits_amount: number;
	auto_pixels_amount: number;
	auto_gotw_amount: number;
	auto_points_amount: number;
	permissions: Record<string, string>;
	permissionMaxValues: Record<string, number>;
}

interface RankUser {
	id: number;
	username: string;
	look: string;
}
interface CmsRoleData {
	id: number;
	slug: string;
	title: string;
	permissionSlugs: string[];
}
interface CmsPermission {
	id: number;
	slug: string;
	title: string;
}
export interface RankEditorProps {
	rank: RankData;
	users: RankUser[];
	totalUsers: number;
	cmsRole: CmsRoleData | null;
	allCmsPermissions: CmsPermission[];
}
