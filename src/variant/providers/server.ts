import { Notice, Setting } from "obsidian";
import { Provider } from "../../core/provider";
import { renderConnectionTest, SettingsHost } from "../../core/settings-host";
import { EuridianError } from "../../core/types";
import { trimTrailingSlash } from "./util";

/** Eigener/selbst gehosteter OpenAI-kompatibler Server (Ollama, vLLM, LM Studio, …). */
export const serverProvider: Provider = {
	id: "server",
	label: "Server",
	lazyScan: true,
	usesSharedThinking: false,
	resolve(s, model) {
		const base = trimTrailingSlash((s.serverUrl || "").trim());
		if (!base) {
			throw new EuridianError(
				"bad_request",
				"Server-URL fehlt — in den Einstellungen eintragen."
			);
		}
		if (!model) {
			throw new EuridianError(
				"bad_request",
				"Kein Modell gewählt — in den Einstellungen festlegen."
			);
		}
		const key = s.serverApiKey.trim();
		const headers: Record<string, string> = {};
		if (key) headers.Authorization = `Bearer ${key}`;
		return {
			chatUrl: `${base}/v1/chat/completions`,
			modelsUrl: `${base}/v1/models`,
			headers,
			model,
			label: "Server",
			offlineHint:
				"Läuft der Server, und ist die URL korrekt? Ggf. VPN/Netzwerk nötig. " +
				"Bei Ollama: `ollama serve`.",
		};
	},
	getModel: (s) => s.serverModel,
	setModel: (s, m) => {
		s.serverModel = m;
	},
	cachedModels: (s) => s.serverModels,
	storeModels: (s, names) => {
		s.serverModels = names;
	},
	renderSettings: renderServerSettings,
	thinking: (s) => s.serverThinking,
};

// ---------------------------------------------------------------- Settings-UI

function errorText(err: unknown): string {
	return err instanceof EuridianError ? err.message : `Unbekannter Fehler: ${String(err)}`;
}

export function renderServerSettings(host: SettingsHost): void {
	const { containerEl } = host;
	const s = host.plugin.settings;

	containerEl.createEl("h3", { text: "Server" });
	containerEl.createEl("p", {
		cls: "setting-item-description",
		text:
			"Für jeden OpenAI-kompatiblen Server: Ollama (lokal oder im Netzwerk), " +
			"vLLM, LM Studio oder ein Hochschul-/Firmenserver. Erwartet die " +
			"Standard-Routen /v1/chat/completions und /v1/models unter der Basis-URL.",
	});

	new Setting(containerEl)
		.setName("Server-URL")
		.setDesc("Basis-URL ohne Pfad, z. B. http://localhost:11434 (Ollama) oder https://llm.example.org")
		.addText((t) => {
			t.setPlaceholder("http://localhost:11434")
				.setValue(s.serverUrl)
				.onChange(async (v) => {
					s.serverUrl = v.trim();
					await host.plugin.saveSettings();
				});
			t.inputEl.autocomplete = "off";
		});

	new Setting(containerEl)
		.setName("API-Key")
		.setDesc("Nur falls der Server Authentifizierung verlangt. Sonst leer lassen.")
		.addText((t) => {
			t.setPlaceholder("Bearer-Token (optional)")
				.setValue(s.serverApiKey)
				.onChange(async (v) => {
					s.serverApiKey = v.trim();
					await host.plugin.saveSettings();
				});
			t.inputEl.type = "password";
			t.inputEl.autocomplete = "off";
		});

	renderModelSelector(host);
	renderScanButton(host);
	renderPreloadButton(host);
	renderThinkingToggle(host);
	renderConnectionTest(host);
}

/** Modell-Auswahl: Dropdown aus gescannter Liste, sonst Freitext. */
function renderModelSelector(host: SettingsHost): void {
	const { containerEl } = host;
	const s = host.plugin.settings;
	const list = s.serverModels;

	if (list.length === 0) {
		new Setting(containerEl)
			.setName("Modell")
			.setDesc("Noch nicht gescannt — unten „Modelle scannen“ klicken. Oder manuell:")
			.addText((t) => {
				t.setPlaceholder("Modellname")
					.setValue(s.serverModel)
					.onChange(async (v) => {
						s.serverModel = v.trim();
						await host.plugin.saveSettings();
					});
				// Ohne autocomplete=off kann der Browser hier fremde Autofill-Vorschläge
				// einsetzen, die dann als „aktuelles Modell" gespeichert würden.
				t.inputEl.autocomplete = "off";
			});
		return;
	}

	new Setting(containerEl)
		.setName("Modell")
		.setDesc(`${list.length} Modell(e) gefunden.`)
		.addDropdown((dd) => {
			for (const name of list) dd.addOption(name, name);
			if (s.serverModel && !list.includes(s.serverModel)) {
				dd.addOption(s.serverModel, `${s.serverModel} (gewählt)`);
			}
			dd.setValue(s.serverModel).onChange(async (v) => {
				s.serverModel = v;
				await host.plugin.saveSettings();
			});
		});
}

/** Button: Modelle vom Server scannen (/v1/models). */
function renderScanButton(host: SettingsHost): void {
	const s = host.plugin.settings;
	const desc =
		s.serverModels.length > 0
			? `Aktuell bekannt: ${s.serverModels.join(", ")}`
			: "Liest die verfügbaren Modelle vom Server.";

	new Setting(host.containerEl)
		.setName("Modelle scannen")
		.setDesc(desc)
		.addButton((btn) =>
			btn
				.setButtonText("Scannen")
				.setCta()
				.onClick(async () => {
					if (!s.serverUrl.trim()) {
						new Notice("Erst die Server-URL eintragen.");
						return;
					}
					btn.setDisabled(true).setButtonText("Scanne …");
					try {
						const base = trimTrailingSlash(s.serverUrl.trim());
						const key = s.serverApiKey.trim();
						const headers: Record<string, string> = {};
						if (key) headers.Authorization = `Bearer ${key}`;
						const models = await host.client.listModels({
							chatUrl: "",
							modelsUrl: `${base}/v1/models`,
							headers,
							model: "",
							label: "Server",
						});
						s.serverModels = models;
						if (models.length > 0 && !models.includes(s.serverModel)) {
							s.serverModel = models[0];
						}
						await host.plugin.saveSettings();
						new Notice(
							models.length
								? `✓ ${models.length} Modell(e) gefunden.`
								: "Keine Modelle gefunden — Modellname manuell eintragen."
						);
						host.display();
					} catch (err) {
						new Notice(`✕ ${errorText(err)}`, 8000);
					} finally {
						btn.setDisabled(false).setButtonText("Scannen");
					}
				})
		);
}

/** Button: Modell vorab laden (nur Ollama, über dessen native Route). */
function renderPreloadButton(host: SettingsHost): void {
	const s = host.plugin.settings;

	new Setting(host.containerEl)
		.setName("Modell vorladen (nur Ollama)")
		.setDesc(
			"Lädt das gewählte Modell vorab in den Arbeitsspeicher, damit der erste Chat ohne Ladezeit startet. Nur für Ollama."
		)
		.addButton((btn) =>
			btn.setButtonText("Laden").onClick(async () => {
				if (!s.serverModel) {
					new Notice("Erst ein Modell wählen.");
					return;
				}
				btn.setDisabled(true).setButtonText("Lade …");
				const t0 = Date.now();
				try {
					await host.client.preloadOllama(s.serverUrl, s.serverModel);
					const secs = ((Date.now() - t0) / 1000).toFixed(1);
					new Notice(`✓ ${s.serverModel} geladen (${secs}s).`);
				} catch (err) {
					new Notice(`✕ ${errorText(err)}`, 8000);
				} finally {
					btn.setDisabled(false).setButtonText("Laden");
				}
			})
		);
}

function renderThinkingToggle(host: SettingsHost): void {
	const s = host.plugin.settings;
	new Setting(host.containerEl)
		.setName("Thinking / Reasoning")
		.setDesc(
			"Reasoning-Modelle „denken“ sonst oft minutenlang vor jeder Antwort — auch im Agenten. Standardmäßig AUS empfohlen."
		)
		.addToggle((t) =>
			t.setValue(s.serverThinking).onChange(async (v) => {
				s.serverThinking = v;
				await host.plugin.saveSettings();
			})
		);
}
