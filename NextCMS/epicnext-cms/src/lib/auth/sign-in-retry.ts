type Wait = (delayMs: number) => Promise<unknown>;

const waitForDelay: Wait = (delayMs) =>
	new Promise((resolve) => setTimeout(resolve, delayMs));

export async function signInWithTransientRetry<T>(
	signIn: () => Promise<T>,
	wait: Wait = waitForDelay,
): Promise<T> {
	const maxAttempts = 4;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await signIn();
		} catch (error) {
			if (attempt === maxAttempts - 1) {
				throw error;
			}

			await wait(400 * 2 ** attempt);
		}
	}

	throw new Error("Unreachable auth retry state");
}
