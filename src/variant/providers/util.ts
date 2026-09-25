/** Entfernt einen abschließenden Slash, damit Pfad-Joins sauber bleiben. */
export function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "");
}
