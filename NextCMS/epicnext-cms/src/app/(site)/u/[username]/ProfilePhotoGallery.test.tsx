import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfilePhotoGallery } from "./ProfilePhotoGallery";
import styles from "./profile.module.css";

const photos = Array.from({ length: 10 }, (_, id) => ({
	id,
	url: `/photo-${id}.png`,
}));
describe("profile photo gallery", () => {
	it("shows six photos initially and discloses the remaining photos accessibly", () => {
		const html = renderToStaticMarkup(
			<ProfilePhotoGallery
				photos={photos}
				username="Alice"
				moreLabel="Mostra altre foto"
				openLabel="Apri foto completa"
			/>,
		);
		expect(html.split("<details")[0].match(/<a /g)).toHaveLength(6);
		expect(html.split("<details")[1].match(/<a /g)).toHaveLength(4);
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain("<summary>Mostra altre foto</summary>");
		if (process.env.ACCOUNT_VISUAL_FIXTURE) {
			let css = readFileSync(
				"src/app/(site)/u/[username]/profile.module.css",
				"utf8",
			);
			for (const name of ["photos", "photo", "more"]) {
				const scoped = styles[name];
				if (scoped)
					css = css.replaceAll(
						new RegExp(`\\.${name}(?=[\\s.{:#>])`, "g"),
						`.${scoped}`,
					);
			}
			mkdirSync("storage/account-fixtures", { recursive: true });
			writeFileSync(
				"storage/account-fixtures/photos.html",
				`<!doctype html><html lang="it"><base href="http://fixtures.local/"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{font:16px Arial;margin:0;padding:20px;background:#f7f5f2}main{max-width:1000px;margin:auto}a{color:#943712}img{background:#dec5ab}${css}</style><main><h1>Foto di Alice</h1>${html}</main></html>`,
			);
		}
	});
	it("excludes executable URL schemes from full-photo links", () => {
		const html = renderToStaticMarkup(
			<ProfilePhotoGallery
				photos={[
					{ id: 1, url: "javascript:alert(1)" },
					{ id: 2, url: "data:text/html,test" },
				]}
				username="Alice"
				moreLabel="More"
				openLabel="Open"
			/>,
		);
		expect(html).not.toContain("<a ");
	});
	it("does not show an empty expansion when there are only six photos", () => {
		expect(
			renderToStaticMarkup(
				<ProfilePhotoGallery
					photos={photos.slice(0, 6)}
					username="Alice"
					moreLabel="More"
					openLabel="Open"
				/>,
			),
		).not.toContain("<details");
	});
});
