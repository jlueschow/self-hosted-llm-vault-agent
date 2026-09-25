/**
 * Euridian — Backend-Auflösung.
 *
 * Delegiert an den Provider des jeweiligen Backends (siehe `provider.ts` und
 * `variant.ts`). Wandelt die Plugin-Einstellungen in einen generischen
 * `ResolvedEndpoint` um, mit dem der `EuridianApiClient` arbeitet.
 */

import { Provider } from "./provider";
import { PROVIDERS } from "../variant";
import { Backend, ModelRef, PluginSettings, ResolvedEndpoint } from "./types";

/** Provider zu einer Backend-ID; unbekannte IDs fallen auf den ersten zurück. */
export function providerFor(backend: Backend): Provider {
	return PROVIDERS.find((p) => p.id === backend) ?? PROVIDERS[0];
}

export function isKnownBackend(backend: unknown): backend is Backend {
	return PROVIDERS.some((p) => p.id === backend);
}

/** Effektiver Thinking-Schalter für das aktive Backend. */
export function effectiveThinking(settings: PluginSettings): boolean {
	return providerFor(settings.backend).thinking(settings);
}

/**
 * Baut den Endpunkt für das aktuell gewählte Backend.
 * Wirft `EuridianError` bei offensichtlich fehlender Config, damit der Nutzer
 * einen klaren Hinweis statt eines Netzwerkfehlers bekommt.
 */
export function resolveEndpoint(settings: PluginSettings): ResolvedEndpoint {
	const p = providerFor(settings.backend);
	return p.resolve(settings, p.getModel(settings));
}

/** Backend + Modell, wie sie in den Settings gerade als Standard gewählt sind. */
export function currentModelRef(settings: PluginSettings): ModelRef {
	const p = providerFor(settings.backend);
	return { backend: p.id, model: p.getModel(settings) };
}

/**
 * Settings-Kopie, in der Backend + Modell durch die eines bestimmten Chats
 * ersetzt sind. So arbeiten `resolveEndpoint`/`effectiveThinking` unverändert,
 * lesen aber nicht mehr den globalen Zustand, sondern den des Chats. URLs und
 * API-Keys bleiben global (die gehören zum Server, nicht zum Chat).
 */
export function settingsForRef(
	settings: PluginSettings,
	ref: ModelRef
): PluginSettings {
	const copy = { ...settings, backend: ref.backend };
	providerFor(ref.backend).setModel(copy, ref.model);
	return copy;
}
