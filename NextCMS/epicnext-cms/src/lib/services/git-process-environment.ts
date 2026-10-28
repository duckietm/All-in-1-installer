/** Git hooks export paths belonging to their repository. Never reuse them for a different checkout. */
export function gitProcessEnvironment(
	source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const environment = { ...source };
	for (const name of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_INDEX_FILE",
		"GIT_COMMON_DIR",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_PREFIX",
		"GIT_IMPLICIT_WORK_TREE",
		"GIT_GRAFT_FILE",
	])
		delete environment[name];
	return environment;
}
