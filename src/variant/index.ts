/**
 * Variante: Self-hosted LLM Vault Agent.
 *
 * Vertrag zwischen gemeinsamem Kern (src/core, identisch in beiden Plugins) und
 * Variante: Der Kern importiert von hier `PROVIDERS`, `DEFAULT_BACKEND`,
 * `VARIANT` und `migrateData`, und aus `./settings` `ProviderSettings` +
 * `PROVIDER_DEFAULTS`.
 */

import { Provider } from "../core/provider";
import { Backend } from "../core/types";
import { serverProvider } from "./providers/server";

export const PROVIDERS: Provider[] = [serverProvider];

export const DEFAULT_BACKEND: Backend = serverProvider.id;

/** Name, Bezeichner und Texte, in denen sich die Varianten unterscheiden. */
export const VARIANT = {
	name: "Vault Agent",
	viewType: "self-hosted-llm-vault-agent-chat",
	intro: "Du bist ein KI-Assistent direkt in Obsidian und arbeitest mit einem selbst gehosteten Sprachmodell.",
	defaultInstructionsPath: "Agent.md",
};

/**
 * Übernimmt Daten aus dem Euridian-Plugin (data.json einfach kopieren): die
 * Backends "ollama" und "custom" werden zum einen Server-Provider.
 */
export function migrateData(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...data };
	const legacy = out.backend === "custom" ? "custom" : "ollama";
	if (out.serverUrl === undefined && ("ollamaUrl" in out || "customUrl" in out)) {
		const url = legacy === "custom" ? out.customUrl : out.ollamaUrl;
		if (typeof url === "string" && url) out.serverUrl = url;
		if (legacy === "custom") {
			if (typeof out.customApiKey === "string") out.serverApiKey = out.customApiKey;
			out.serverThinking = out.enableThinking === true;
		} else if (typeof out.ollamaThinking === "boolean") {
			out.serverThinking = out.ollamaThinking;
		}
		const model = legacy === "custom" ? out.customModel : out.ollamaModel;
		const models = legacy === "custom" ? out.customModels : out.ollamaModels;
		if (typeof model === "string") out.serverModel = model;
		if (Array.isArray(models)) out.serverModels = models;
	}
	for (const k of [
		"ollamaUrl", "ollamaModel", "ollamaModels", "ollamaThinking",
		"customUrl", "customApiKey", "customModel", "customModels",
		"infomaniakApiKey", "infomaniakProductId", "infomaniakModel",
		"infomaniakCatalog", "infomaniakCatalogFetchedAt", "infomaniakOnlyAvailable",
	]) delete out[k];
	out.backend = serverProvider.id;

	// Gespeicherte Chats: Modellverweise auf den Server-Provider umbiegen und
	// Chats, die an Infomaniak hingen, auf das Standardmodell zurücksetzen.
	const sessions = out.__euridianSessions as
		| { tabs?: { modelRef?: { backend?: string; model?: string } }[] }
		| undefined;
	if (sessions?.tabs) {
		for (const tab of sessions.tabs) {
			if (!tab.modelRef) continue;
			if (tab.modelRef.backend === "infomaniak") delete tab.modelRef;
			else tab.modelRef.backend = serverProvider.id;
		}
	}
	return out;
}
