/**
 * Euridian — Websuche für den Agenten (Function Calling): DuckDuckGo (ohne
 * Account/Key) oder Brave Search API (Key nötig, stabiler).
 *
 * Läuft über Obsidians `requestUrl` auf dem Rechner des Nutzers — nicht über
 * das Modell. So kann auch ein Modell auf einem Server ohne eigenen
 * Internetzugang (z. B. ein internes Hochschulnetz) recherchieren: das
 * Plugin führt die Suche lokal aus und reicht das Ergebnis als Text zurück.
 *
 * Unabhängig vom Vault-Agent aktivierbar (eigener Schalter in den Settings).
 */

import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { EuridianError, ToolCall, ToolDefinition, WebSearchProvider } from "./types";

/** Was die Suche zum Ausführen braucht. */
export interface WebSearchConfig {
	webSearchProvider: WebSearchProvider;
	braveApiKey: string;
}

/** Ist die Suche mit dieser Konfiguration nutzbar (Brave braucht einen Key)? */
export function isWebSearchReady(cfg: WebSearchConfig): boolean {
	return cfg.webSearchProvider === "duckduckgo" || !!cfg.braveApiKey.trim();
}

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
					"Searches the web and returns title, URL and a short description of " +
					"the top results. Use it for current information that is not in the vault.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search query.",
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
	cfg: WebSearchConfig,
	call: ToolCall
): Promise<string> {
	let args: Record<string, string>;
	try {
		args = JSON.parse(call.function.arguments || "{}") as Record<string, string>;
	} catch {
		return "Error: the arguments were not valid JSON.";
	}

	try {
		switch (call.function.name) {
			case "search_web":
				return await searchWeb(cfg, args.query);
			default:
				return `Error: unknown tool "${call.function.name}".`;
		}
	} catch (err) {
		return `Error in ${call.function.name}: ${
			err instanceof Error ? err.message : String(err)
		}`;
	}
}

/**
 * Führt die Suche mit dem gewählten Anbieter aus. Wirft `EuridianError` bei
 * Fehlern — wird von `executeWebToolCall` gefangen (modell-seitig) bzw. vom
 * "Verbindung testen"-Button in den Settings direkt genutzt.
 */
export async function searchWeb(cfg: WebSearchConfig, query: string): Promise<string> {
	if (!query?.trim()) {
		throw new EuridianError("bad_request", "Leerer Suchbegriff.");
	}
	return cfg.webSearchProvider === "brave"
		? searchBrave(cfg.braveApiKey.trim(), query)
		: searchDuckDuckGo(query);
}

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";

/** Formatiert Treffer als nummerierte Liste (Titel, URL, Beschreibung). */
function formatResults(results: { title: string; url: string; description: string }[]): string {
	if (results.length === 0) return "No search results found.";
	return results
		.slice(0, MAX_RESULTS)
		.map((r, i) => `${i + 1}. ${r.title || "(ohne Titel)"}\n   ${r.url}\n   ${r.description}`)
		.join("\n\n");
}

/**
 * DuckDuckGo ohne Account: liest die HTML-Ergebnisseite. DuckDuckGo bietet dafür
 * keine offizielle API — die Suche kann sich daher ändern oder bei zu vielen
 * Anfragen mit einer Bot-Abfrage blockiert werden (dann Brave nutzen).
 */
async function searchDuckDuckGo(query: string): Promise<string> {
	let res;
	try {
		res = await requestUrl({
			url: `${DDG_HTML_URL}?q=${encodeURIComponent(query)}&kl=de-de`,
			method: "GET",
			headers: { Accept: "text/html" },
			throw: false,
		});
	} catch {
		throw new EuridianError(
			"offline",
			t("DuckDuckGo is not reachable. Check your internet connection.")
		);
	}

	const doc = new DOMParser().parseFromString(res.text ?? "", "text/html");
	const nodes = Array.from(doc.querySelectorAll(".result"));
	const results: { title: string; url: string; description: string }[] = [];
	for (const node of nodes) {
		const link = node.querySelector("a.result__a");
		if (!link || node.classList.contains("result--ad")) continue;
		const href = link.getAttribute("href") ?? "";
		let url = href;
		try {
			// Treffer-Links laufen über einen Weiterleiter (?uddg=<ziel-url>).
			const u = new URL(href, "https://duckduckgo.com");
			url = u.searchParams.get("uddg") ?? u.toString();
		} catch {
			// href unverändert lassen
		}
		results.push({
			title: (link.textContent ?? "").trim(),
			url,
			description: (node.querySelector(".result__snippet")?.textContent ?? "").trim(),
		});
	}

	if (results.length === 0) {
		if (res.status === 202 || res.status === 429 || res.text?.includes("anomaly")) {
			throw new EuridianError(
				"rate_limit",
				t("DuckDuckGo is blocking the request (bot check). Try again later or switch to Brave Search in the settings."),
				res.status
			);
		}
		if (res.status >= 400) {
			throw new EuridianError("unknown", `DuckDuckGo: HTTP ${res.status}.`, res.status);
		}
	}
	return formatResults(results);
}

async function searchBrave(apiKey: string, query: string): Promise<string> {
	if (!apiKey) {
		throw new EuridianError(
			"auth",
			t("No Brave Search API key set (settings, web search).")
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
			t("Brave Search is not reachable. Check your internet connection.")
		);
	}

	if (res.status === 401 || res.status === 403) {
		throw new EuridianError(
			"auth",
			t("Brave Search: invalid API key. Check it in the settings."),
			res.status
		);
	}
	if (res.status === 429) {
		throw new EuridianError(
			"rate_limit",
			t("Brave Search: rate limit reached. Please wait a moment."),
			res.status
		);
	}
	if (res.status >= 400) {
		throw new EuridianError("unknown", `Brave Search: HTTP ${res.status}.`, res.status);
	}

	const results = (
		res.json as
			| { web?: { results?: { title?: string; url?: string; description?: string }[] } }
			| undefined
	)?.web?.results;
	if (!Array.isArray(results)) return "No search results found.";
	return formatResults(
		results.map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			description: (r.description ?? "").replace(/<[^>]+>/g, "").trim(),
		}))
	);
}
