/**
 * Euridian — Schnittstelle zwischen Settings-Tab und Provider-Einstellungen.
 * Der Tab übergibt sich selbst; Provider rendern ihre Felder in `containerEl`
 * und rufen `display()` auf, wenn die ganze Ansicht neu gezeichnet werden soll.
 */

import { Notice, Setting } from "obsidian";
import { resolveEndpoint } from "./backend";
import { t } from "./i18n";
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
		.setName(t("Test connection"))
		.setDesc(t("Fetches the model list from the backend."))
		.addButton((btn) =>
			btn
				.setButtonText(t("Test"))
				.setCta()
				.onClick(async () => {
					btn.setDisabled(true).setButtonText(t("Testing …"));
					try {
						const endpoint = resolveEndpoint(host.plugin.settings);
						const models = await host.client.listModels(endpoint);
						new Notice(
							t("✓ Connected to {label}. {count} model(s) found.", {
								label: endpoint.label,
								count: models.length,
							})
						);
					} catch (err) {
						const msg =
							err instanceof EuridianError
								? err.message
								: t("Unknown error: {error}", { error: String(err) });
						new Notice(`✕ ${msg}`, 8000);
					} finally {
						btn.setDisabled(false).setButtonText(t("Test"));
					}
				})
		);
}
