/**
 * Euridian — Websuche für den Agenten (Function Calling), via Brave Search API.
 *
 * Läuft über Obsidians `requestUrl` auf dem Rechner des Nutzers — nicht über
 * das Modell. So kann auch ein Modell auf einem Server ohne eigenen
 * Internetzugang (z. B. ein internes Hochschulnetz) recherchieren: das
 * Plugin führt die Suche lokal aus und reicht das Ergebnis als Text zurück.
 *
 * Unabhängig vom Vault-Agent aktivierbar (eigener Schalter in den Settings).
 */

import { requestUrl } from "obsidian";
import { EuridianError, ToolCall, ToolDefinition } from "./types";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 8;

/** Die Werkzeug-Definition, die dem Modell mitgeschickt wird. */
export function getWebToolDefinitions(): ToolDefinition[] {
	return [
		{
			type: "function",
			function: {
				name: "search_web",
				description:
					"Durchsucht das Internet (Brave Search) und gibt Titel, URL und " +
					"kurze Beschreibung der Top-Treffer zurück. Nutze dies für aktuelle " +
					"Informationen, die nicht im Vault stehen.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Suchbegriff.",
						},
					},
					required: ["query"],
				},
			},
		},
	];
}

/** True, wenn der Name eines dieser Werkzeuge ist (zum Zusammenführen mit Vault-Tools). */
export function isWebTool(name: string): boolean {
	return name === "search_web";
}

/**
 * Führt einen Web-Tool-Call aus und gibt das Ergebnis als String zurück
 * (wird dem Modell als tool-Nachricht zurückgereicht). Wirft nicht — Fehler
 * kommen als lesbarer Text zurück, damit das Modell darauf reagieren kann.
 */
export async function executeWebToolCall(
	braveApiKey: string,
	call: ToolCall
): Promise<string> {
	let args: Record<string, string>;
	try {
		args = JSON.parse(call.function.arguments || "{}");
	} catch {
		return "Fehler: Argumente waren kein gültiges JSON.";
	}

	try {
		switch (call.function.name) {
			case "search_web":
				return await searchWeb(braveApiKey, args.query);
			default:
				return `Fehler: Unbekanntes Werkzeug "${call.function.name}".`;
		}
	} catch (err) {
		return `Fehler bei ${call.function.name}: ${
			err instanceof Error ? err.message : String(err)
		}`;
	}
}

/**
 * Führt die eigentliche Brave-Suche aus. Wirft `EuridianError` bei Fehlern —
 * wird von `executeWebToolCall` gefangen (modell-seitig) bzw. vom
 * "Verbindung testen"-Button in den Settings direkt genutzt.
 */
export async function searchWeb(apiKey: string, query: string): Promise<string> {
	if (!query?.trim()) {
		throw new EuridianError("bad_request", "Leerer Suchbegriff.");
	}
	if (!apiKey) {
		throw new EuridianError(
			"auth",
			"Kein Brave-Search-API-Key hinterlegt (Einstellungen → Websuche)."
		);
	}

	let res;
	try {
		res = await requestUrl({
			url: `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
			method: "GET",
			headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
			throw: false,
		});
	} catch {
		throw new EuridianError(
			"offline",
			"Brave Search nicht erreichbar — Internetverbindung prüfen."
		);
	}

	if (res.status === 401 || res.status === 403) {
		throw new EuridianError(
			"auth",
			"Brave Search: API-Key ungültig — in den Einstellungen prüfen.",
			res.status
		);
	}
	if (res.status === 429) {
		throw new EuridianError(
			"rate_limit",
			"Brave Search: Rate-Limit erreicht — bitte kurz warten.",
			res.status
		);
	}
	if (res.status >= 400) {
		throw new EuridianError("unknown", `Brave Search: HTTP ${res.status}.`, res.status);
	}

	const results = res.json?.web?.results;
	if (!Array.isArray(results) || results.length === 0) {
		return "Keine Suchergebnisse gefunden.";
	}

	return results
		.slice(0, MAX_RESULTS)
		.map(
			(
				r: { title?: string; url?: string; description?: string },
				i: number
			) => {
				const desc = (r.description ?? "").replace(/<[^>]+>/g, "").trim();
				return `${i + 1}. ${r.title ?? "(ohne Titel)"}\n   ${r.url ?? ""}\n   ${desc}`;
			}
		)
		.join("\n\n");
}
