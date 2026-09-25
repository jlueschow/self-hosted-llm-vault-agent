/**
 * Euridian — Provider-Schnittstelle.
 *
 * Ein Provider kapselt alles, was ein konkretes Backend ausmacht: wie der
 * Endpunkt aus den Einstellungen gebaut wird, wo das gewählte Modell und die
 * Modellliste gespeichert sind und wie das Thinking-Default aussieht. Chat-View,
 * Inline-Edit und Backend-Auflösung kennen nur diese Schnittstelle.
 */

import { SettingsHost } from "./settings-host";
import { Backend, PluginSettings, ResolvedEndpoint } from "./types";

export interface Provider {
	/** Stabile ID, wird in gespeicherten Chats (`ModelRef.backend`) abgelegt. */
	id: Backend;
	/** Anzeigename (Statuszeile, Fehlerhinweise). */
	label: string;
	/**
	 * Baut den Endpunkt für das Modell `model`. Wirft `EuridianError("bad_request"
	 * | "auth", …)` bei fehlender Konfiguration.
	 */
	resolve(settings: PluginSettings, model: string): ResolvedEndpoint;
	/** Das in den Einstellungen gewählte Standardmodell. */
	getModel(settings: PluginSettings): string;
	setModel(settings: PluginSettings, model: string): void;
	/** Bekannte Modelle für das Dropdown (gecachte Liste aus den Einstellungen). */
	cachedModels(settings: PluginSettings): string[];
	/**
	 * true → das Dropdown lädt die Modellliste beim ersten Öffnen per
	 * `/v1/models` nach und speichert sie über `storeModels`.
	 */
	lazyScan: boolean;
	storeModels(settings: PluginSettings, names: string[]): void;
	/** Rendert die Grundfelder (URL, Key, Modellwahl, Verbindungstest) im Settings-Tab. */
	renderSettings(host: SettingsHost): void;
	/** Selten nötige Provider-Optionen; erscheinen nur in der erweiterten Ansicht. */
	renderAdvancedSettings?(host: SettingsHost): void;
	/**
	 * true → das Backend folgt dem gemeinsamen Thinking-Schalter der Einstellungen
	 * (`enableThinking`). false → der Provider bringt einen eigenen mit.
	 */
	usesSharedThinking: boolean;
	/** Effektiver Thinking-Schalter für dieses Backend. */
	thinking(settings: PluginSettings): boolean;
}
