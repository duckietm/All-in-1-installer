export async function fixtureAction(name: string, input: unknown = {}) {
	const response = await fetch(`/fixture/actions/${name}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw Error(`Fixture action failed: ${response.status}`);
	return response.json();
}
export const saveManagedSettings = (input: unknown) =>
	fixtureAction("settings", input);
export const listTableViews = (input: unknown) =>
	fixtureAction("list-views", input);
export const saveTableView = (input: unknown) =>
	fixtureAction("save-view", input);
export const deleteTableView = (input: unknown) =>
	fixtureAction("delete-view", input);
export const loadArticleRecovery = (key: unknown) =>
	fixtureAction("load-recovery", { key });
export const autosaveArticle = (...input: unknown[]) =>
	fixtureAction("autosave", input);
export const clearArticleRecovery = (...input: unknown[]) =>
	fixtureAction("clear-recovery", input);
export const uploadMediaAndReturn = () => fixtureAction("upload");

export const createEvent = (input: unknown) =>
	fixtureAction("create-event", input);
export const updateEvent = (input: unknown) =>
	fixtureAction("update-event", input);

export const deleteImportedFurni = (input: unknown) =>
	fixtureAction("delete-imported-furni", input);
export const setFurnidataTranslateEnabled = (input: unknown) =>
	fixtureAction("furnidata-translation", input);

export const organizeImportFurni = (input: unknown) =>
	fixtureAction("organize-import-furni", input);
