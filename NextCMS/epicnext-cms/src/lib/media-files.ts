export type MediaFile = {
	name: string;
	url: string;
	size: number;
	uploaded: number;
};

/** Only allow safe, relative /api/media URLs as image src. */
export function validImageUrl(url: string): string {
	if (!url.startsWith("/")) return "";
	if (/[<>"']/.test(url)) return "";
	if (/(data|javascript|vbscript|file):/i.test(url)) return "";
	return url;
}

/** Load the media library from /api/media, tolerating transient failures. */
export async function loadMediaFiles(): Promise<MediaFile[]> {
	try {
		const res = await fetch("/api/media");
		const data = await res.json();
		return Array.isArray(data?.files) ? (data.files as MediaFile[]) : [];
	} catch {
		return [];
	}
}
