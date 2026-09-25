/**
 * Variant-spezifische Einstellungsfelder (Provider-Konfiguration) + Defaults.
 * Diese Datei gehört zur Variante, nicht zum gemeinsamen Kern.
 */

/** Provider-Felder von `PluginSettings` (landen in data.json). */
export interface ProviderSettings {
	/** Basis-URL des Servers, z. B. "http://localhost:11434". Ohne Pfad-Suffix. */
	serverUrl: string;
	/** Optionaler Bearer-Token. Leer = kein Authorization-Header. */
	serverApiKey: string;
	serverModel: string;
	/** Gescannte Modelle (von /v1/models). */
	serverModels: string[];
	/**
	 * Thinking/Reasoning des Modells. Default AUS: lokale Reasoning-Modelle sind
	 * sonst oft minutenlang am „Nachdenken".
	 */
	serverThinking: boolean;
}

/** Defaults der Provider-Felder (werden in `DEFAULT_SETTINGS` eingemischt). */
export const PROVIDER_DEFAULTS: ProviderSettings = {
	serverUrl: "http://localhost:11434",
	serverApiKey: "",
	serverModel: "",
	serverModels: [],
	serverThinking: false,
};
