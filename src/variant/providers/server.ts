import { Notice, Setting } from "obsidian";
import { t } from "../../core/i18n";
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
				t("Server URL is missing. Enter it in the settings.")
			);
		}
		if (!model) {
			throw new EuridianError(
				"bad_request",
				t("No model selected. Choose one in the settings.")
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
			label: t("Server"),
			offlineHint:
				t("Is the server running, and is the URL correct? A VPN or network connection may be needed. For Ollama: `ollama serve`."),
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
	renderAdvancedSettings: renderServerAdvanced,
	thinking: (s) => s.serverThinking,
};

// ---------------------------------------------------------------- Settings-UI

function errorText(err: unknown): string {
	return err instanceof EuridianError ? err.message : t("Unknown error: {error}", { error: String(err) });
}

export function renderServerSettings(host: SettingsHost): void {
	const { containerEl } = host;
	const s = host.plugin.settings;

	containerEl.createEl("p", {
		cls: "setting-item-description",
		text: t(
			"For any OpenAI-compatible server: Ollama (local or on the network), vLLM, LM Studio, or a university or company server. Expects the standard routes /v1/chat/completions and /v1/models under the base URL."
		),
	});

	new Setting(containerEl)
		.setName(t("Server URL"))
		.setDesc(t("Base URL without a path, e.g. http://localhost:11434 (Ollama) or https://llm.example.org"))
		.addText((tg) => {
			tg.setPlaceholder("http://localhost:11434")
				.setValue(s.serverUrl)
				.onChange(async (v) => {
					s.serverUrl = v.trim();
					await host.plugin.saveSettings();
				});
			tg.inputEl.autocomplete = "off";
		});

	new Setting(containerEl)
		.setName(t("API key"))
		.setDesc(t("Only if the server requires authentication. Otherwise leave empty."))
		.addText((tg) => {
			tg.setPlaceholder(t("Bearer token (optional)"))
				.setValue(s.serverApiKey)
				.onChange(async (v) => {
					s.serverApiKey = v.trim();
					await host.plugin.saveSettings();
				});
			tg.inputEl.type = "password";
			tg.inputEl.autocomplete = "off";
		});

	renderModelSelector(host);
	renderScanButton(host);
	renderConnectionTest(host);
}

/** Selten nötig: Modell vorladen und Thinking-Schalter. */
function renderServerAdvanced(host: SettingsHost): void {
	renderThinkingToggle(host);
	renderPreloadButton(host);
}

/** Modell-Auswahl: Dropdown aus gescannter Liste, sonst Freitext. */
function renderModelSelector(host: SettingsHost): void {
	const { containerEl } = host;
	const s = host.plugin.settings;
	const list = s.serverModels;

	if (list.length === 0) {
		new Setting(containerEl)
			.setName(t("Model"))
			.setDesc(t("Not scanned yet. Click \"Scan models\" below, or enter a name manually:"))
			.addText((tg) => {
				tg.setPlaceholder(t("Model name"))
					.setValue(s.serverModel)
					.onChange(async (v) => {
						s.serverModel = v.trim();
						await host.plugin.saveSettings();
					});
				// Ohne autocomplete=off kann der Browser hier fremde Autofill-Vorschläge
				// einsetzen, die dann als „aktuelles Modell" gespeichert würden.
				tg.inputEl.autocomplete = "off";
			});
		return;
	}

	new Setting(containerEl)
		.setName(t("Model"))
		.setDesc(t("{count} model(s) found.", { count: list.length }))
		.addDropdown((dd) => {
			for (const name of list) dd.addOption(name, name);
			if (s.serverModel && !list.includes(s.serverModel)) {
				dd.addOption(s.serverModel, t("{model} (selected)", { model: s.serverModel }));
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
			? t("Currently known: {models}", { models: s.serverModels.join(", ") })
			: t("Reads the available models from the server.");

	new Setting(host.containerEl)
		.setName(t("Scan models"))
		.setDesc(desc)
		.addButton((btn) =>
			btn
				.setButtonText(t("Scan"))
				.setCta()
				.onClick(async () => {
					if (!s.serverUrl.trim()) {
						new Notice(t("Enter the server URL first."));
						return;
					}
					btn.setDisabled(true).setButtonText(t("Scanning …"));
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
							label: t("Server"),
						});
						s.serverModels = models;
						if (models.length > 0 && !models.includes(s.serverModel)) {
							s.serverModel = models[0];
						}
						await host.plugin.saveSettings();
						new Notice(
							models.length
								? t("✓ {count} model(s) found.", { count: models.length })
								: t("No models found. Enter the model name manually.")
						);
						host.display();
					} catch (err) {
						new Notice(`✕ ${errorText(err)}`, 8000);
					} finally {
						btn.setDisabled(false).setButtonText(t("Scan"));
					}
				})
		);
}

/** Button: Modell vorab laden (nur Ollama, über dessen native Route). */
function renderPreloadButton(host: SettingsHost): void {
	const s = host.plugin.settings;

	new Setting(host.containerEl)
		.setName(t("Preload model (Ollama only)"))
		.setDesc(
			t("Loads the selected model into memory ahead of time so the first chat starts without a loading delay. Ollama only.")
		)
		.addButton((btn) =>
			btn.setButtonText(t("Load")).onClick(async () => {
				if (!s.serverModel) {
					new Notice(t("Choose a model first."));
					return;
				}
				btn.setDisabled(true).setButtonText(t("Loading …"));
				const t0 = Date.now();
				try {
					await host.client.preloadOllama(s.serverUrl, s.serverModel);
					const secs = ((Date.now() - t0) / 1000).toFixed(1);
					new Notice(t("✓ {model} loaded ({secs}s).", { model: s.serverModel, secs }));
				} catch (err) {
					new Notice(`✕ ${errorText(err)}`, 8000);
				} finally {
					btn.setDisabled(false).setButtonText(t("Load"));
				}
			})
		);
}

function renderThinkingToggle(host: SettingsHost): void {
	const s = host.plugin.settings;
	new Setting(host.containerEl)
		.setName(t("Thinking / reasoning"))
		.setDesc(
			t("Reasoning models can otherwise \"think\" for minutes before every answer, including in the agent. Off is recommended.")
		)
		.addToggle((tg) =>
			tg.setValue(s.serverThinking).onChange(async (v) => {
				s.serverThinking = v;
				await host.plugin.saveSettings();
			})
		);
}
