import { ProfileImage } from "@/components/shared/profile-image";
import styles from "./profile.module.css";
export function ProfilePhotoGallery({
	photos,
	username,
	moreLabel,
	openLabel,
}: {
	photos: { id: number; url: string }[];
	username: string;
	moreLabel: string;
	openLabel: string;
}) {
	const safePhotos = photos.filter((photo) => {
		try {
			const url = new URL(photo.url, "https://profile.invalid");
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	});
	const gallery = (rows: typeof photos) => (
		<div className={styles.photos}>
			{rows.map((photo) => (
				<a
					key={photo.id}
					href={photo.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`${openLabel} · ${username}`}
				>
					<ProfileImage
						src={photo.url}
						alt={username}
						width={320}
						height={320}
						className={styles.photo}
					/>
					<span>{openLabel} ↗</span>
				</a>
			))}
		</div>
	);
	return (
		<>
			{gallery(safePhotos.slice(0, 6))}
			{safePhotos.length > 6 && (
				<details className={styles.more}>
					<summary>{moreLabel}</summary>
					{gallery(safePhotos.slice(6))}
				</details>
			)}
		</>
	);
}
