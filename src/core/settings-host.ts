/**
 * Euridian — Schnittstelle zwischen Settings-Tab und Provider-Einstellungen.
 * Der Tab übergibt sich selbst; Provider rendern ihre Felder in `containerEl`
 * und rufen `display()` auf, wenn die ganze Ansicht neu gezeichnet werden soll.
 */

import { Notice, Setting } from "obsidian";
import { resolveEndpoint } from "./backend";
import { EuridianError } from "./types";
import type { EuridianApiClient } from "./api-client";
import type EuridianPlugin from "./main";

export interface SettingsHost {
	containerEl: HTMLElement;
	plugin: EuridianPlugin;
	client: EuridianApiClient;
	display(): void;
}

/** Button "Verbindung testen" — ruft die Modell-Liste des Backends ab. */
export function renderConnectionTest(host: SettingsHost): void {
	new Setting(host.containerEl)
		.setName("Verbindung testen")
		.setDesc("Ruft die Modell-Liste des Backends ab.")
		.addButton((btn) =>
			btn
				.setButtonText("Testen")
				.setCta()
				.onClick(async () => {
					btn.setDisabled(true).setButtonText("Teste …");
					try {
						const endpoint = resolveEndpoint(host.plugin.settings);
						const models = await host.client.listModels(endpoint);
						new Notice(
							`✓ Verbunden mit ${endpoint.label}. ` +
								`${models.length} Modell(e) gefunden.`
						);
					} catch (err) {
						const msg =
							err instanceof EuridianError
								? err.message
								: `Unbekannter Fehler: ${String(err)}`;
						new Notice(`✕ ${msg}`, 8000);
					} finally {
						btn.setDisabled(false).setButtonText("Testen");
					}
				})
		);
}
