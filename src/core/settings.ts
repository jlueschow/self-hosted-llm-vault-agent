/**
 * Euridian — Einstellungen: Defaults + Settings-Tab-UI.
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { EuridianApiClient } from "./api-client";
import { providerFor } from "./backend";
import { DEFAULT_BACKEND, PROVIDERS, VARIANT } from "../variant";
import { PROVIDER_DEFAULTS } from "../variant/settings";
import { isWebSearchReady, searchWeb } from "./web-tools";
import { currentLanguage, t } from "./i18n";
import { TEMPLATES_DE, TEMPLATES_EN } from "./locales/templates";
import { EuridianError, PluginSettings, PromptTemplate } from "./types";
import type EuridianPlugin from "./main";

/** Mitgelieferte Prompt-Vorlagen in der Sprache der Oberfläche. */
export const DEFAULT_TEMPLATES: PromptTemplate[] =
	currentLanguage() === "de" ? TEMPLATES_DE : TEMPLATES_EN;

export const DEFAULT_SETTINGS: PluginSettings = {
	...PROVIDER_DEFAULTS,
	showAdvancedSettings: false,
	backend: DEFAULT_BACKEND,

	includeCurrentNote: true,
	euridianInstructionsPath: VARIANT.defaultInstructionsPath,
	systemPrompt: "",
	enableThinking: true,
	temperature: 0.7,
	maxContextMessages: 10,
	autoCompactHistory: true,
	enableVaultAgent: true,
	confirmBeforeWrite: true,
	promptTemplates: DEFAULT_TEMPLATES,

	enableWebSearch: false,
	webSearchProvider: "duckduckgo",
	braveApiKey: "",
};

export class EuridianSettingTab extends PluginSettingTab {
	plugin: EuridianPlugin;
	client = new EuridianApiClient();

	constructor(app: App, plugin: EuridianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Beim Schließen des Settings-Tabs offene Chats auffrischen (Modelllisten etc.). */
	hide(): void {
		this.plugin.refreshChatViews();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const s = this.plugin.settings;

		// --- Backend-Auswahl (nur bei mehreren Providern) ---
		if (PROVIDERS.length > 1) {
			new Setting(containerEl)
				.setName("Backend")
				.setDesc(t("Which service provides the answers."))
				.addDropdown((dd) => {
					for (const p of PROVIDERS) dd.addOption(p.id, p.label);
					return dd
						.setValue(s.backend)
						.onChange(async (value) => {
							s.backend = value;
							await this.plugin.saveSettings();
							this.display(); // UI neu rendern (zeigt passende Felder)
						});
				});
		}

		// --- Backend-spezifische Felder ---
		providerFor(s.backend).renderSettings(this);

		// --- Gemeinsame Verhaltens-Einstellungen ---
		new Setting(containerEl).setName(t("Behavior")).setHeading();

		new Setting(containerEl)
			.setName(t("Vault agent"))
			.setDesc(
				t(
					"Lets the model read, search, create and edit notes (function calling). Deleting is blocked. The model must support tool calling."
				)
			)
			.addToggle((tg) =>
				tg.setValue(s.enableVaultAgent).onChange(async (v) => {
					s.enableVaultAgent = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("Confirm before writing"))
			.setDesc(
				t(
					"Asks before creating, appending to or overwriting notes, with a preview. Reading and searching never ask. Recommended: prevents unrequested or hallucinated notes."
				)
			)
			.addToggle((tg) =>
				tg.setValue(s.confirmBeforeWrite).onChange(async (v) => {
					s.confirmBeforeWrite = v;
					await this.plugin.saveSettings();
				})
			);

		this.renderWebSearchSettings();

		// --- Umschalter einfach / erweitert ---
		new Setting(containerEl)
			.setName(t("Advanced settings"))
			.setDesc(
				t(
					"Shows more options (context, system prompt, temperature, templates, …). The defaults suit most people."
				)
			)
			.addToggle((tg) =>
				tg.setValue(s.showAdvancedSettings).onChange(async (v) => {
					s.showAdvancedSettings = v;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (!s.showAdvancedSettings) return;

		new Setting(containerEl).setName(t("Advanced")).setHeading();
		providerFor(s.backend).renderAdvancedSettings?.(this);

		new Setting(containerEl)
			.setName(t("Current note as context"))
			.setDesc(t("Sends the content of the open note along as system context."))
			.addToggle((tg) =>
				tg.setValue(s.includeCurrentNote).onChange(async (v) => {
					s.includeCurrentNote = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("{name} instructions file", { name: VARIANT.name }))
			.setDesc(
				t(
					"Vault path to a short instructions file for {name} (for example vault conventions or folder structure). Leave empty for none. Default: {path} in the vault root. Do not enter your vault-wide CLAUDE.md: large instruction files written for other assistants derail the agent.",
					{ name: VARIANT.name, path: VARIANT.defaultInstructionsPath }
				)
			)
			.addText((tg) => {
				tg.setPlaceholder(VARIANT.defaultInstructionsPath)
					.setValue(s.euridianInstructionsPath)
					.onChange(async (v) => {
						s.euridianInstructionsPath = v.trim();
						await this.plugin.saveSettings();
					});
				tg.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName(t("System prompt"))
			.setDesc(t("Optional persona or style instructions for the AI."))
			.addTextArea((ta) => {
				ta.setPlaceholder(t("You are a helpful assistant …"))
					.setValue(s.systemPrompt)
					.onChange(async (v) => {
						s.systemPrompt = v;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 3;
				ta.inputEl.addClass("euridian-settings-textarea");
			});

		if (PROVIDERS.some((p) => p.usesSharedThinking)) {
			new Setting(containerEl)
				.setName(t("Thinking / reasoning"))
				.setDesc(
					t(
						"Turns on the model's \"thinking\". Off is faster and cheaper (reasoning_effort: none)."
					)
				)
				.addToggle((tg) =>
					tg.setValue(s.enableThinking).onChange(async (v) => {
						s.enableThinking = v;
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl)
			.setName(t("Temperature"))
			.setDesc(t("0 = deterministic, 2 = very creative."))
			.addSlider((sl) =>
				sl
					.setLimits(0, 2, 0.1)
					.setValue(s.temperature)
					.onChange(async (v) => {
						s.temperature = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("Max. context messages"))
			.setDesc(
				t(
					"Oldest messages beyond this limit are dropped from the full context (saves tokens)."
				)
			)
			.addSlider((sl) =>
				sl
					.setLimits(2, 30, 1)
					.setValue(s.maxContextMessages)
					.onChange(async (v) => {
						s.maxContextMessages = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("Compress history automatically"))
			.setDesc(
				t(
					"Instead of discarding dropped messages entirely, keep them as an LLM summary (one extra background request the first time the limit is exceeded). Works like auto-compact in Claude Code."
				)
			)
			.addToggle((tg) =>
				tg.setValue(s.autoCompactHistory).onChange(async (v) => {
					s.autoCompactHistory = v;
					await this.plugin.saveSettings();
				})
			);


		this.renderPromptTemplates();
	}

	/** Websuche (optional, unabhängig vom Vault-Agent) — Brave Search API. */
	private renderWebSearchSettings(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;

		new Setting(containerEl).setName(t("Web search (optional)")).setHeading();

		new Setting(containerEl)
			.setName(t("Enable web search"))
			.setDesc(
				t(
					'Gives the agent the "search_web" tool. The search always runs locally on your computer, even if your server has no internet access itself.'
				)
			)
			.addToggle((tg) =>
				tg.setValue(s.enableWebSearch).onChange(async (v) => {
					s.enableWebSearch = v;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (!s.enableWebSearch) return;

		new Setting(containerEl)
			.setName(t("Search provider"))
			.setDesc(
				t(
					"DuckDuckGo needs no account but is unofficial and can be blocked after many requests. Brave Search is more stable but needs a free API key."
				)
			)
			.addDropdown((dd) =>
				dd
					.addOption("duckduckgo", t("DuckDuckGo (no account)"))
					.addOption("brave", t("Brave Search (API key)"))
					.setValue(s.webSearchProvider)
					.onChange(async (v) => {
						s.webSearchProvider = v as PluginSettings["webSearchProvider"];
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (s.webSearchProvider === "brave") {
			new Setting(containerEl)
				.setName(t("Brave Search API key"))
				.setDesc(
					t("Free key at brave.com/search/api (free tier: 2000 requests per month).")
				)
				.addText((tg) => {
					tg.setPlaceholder("BSA...")
						.setValue(s.braveApiKey)
						.onChange(async (v) => {
							s.braveApiKey = v.trim();
							await this.plugin.saveSettings();
						});
					tg.inputEl.type = "password";
				});
		}

		new Setting(containerEl)
			.setName(t("Test connection"))
			.setDesc(t("Runs a test search."))
			.addButton((btn) =>
				btn
					.setButtonText(t("Test"))
					.onClick(async () => {
						if (!isWebSearchReady(s)) {
							new Notice(t("Enter the API key first."));
							return;
						}
						btn.setDisabled(true).setButtonText(t("Testing …"));
						try {
							await searchWeb(s, "test");
							new Notice(
								t("✓ {provider} reachable.", {
									provider:
										s.webSearchProvider === "brave" ? "Brave Search" : "DuckDuckGo",
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

	/** Verwaltung der Prompt-Vorlagen (Slash-Commands): Liste + Löschen + Anlegen. */
	private renderPromptTemplates(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;

		new Setting(containerEl).setName(t("Prompt templates (slash commands)")).setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: t(
				"Type / in the chat to insert a template. Placeholders: {{input}} (cursor for your text), {{selection}} (selected text), {{note}} (whole note), {{title}} (note title)."
			),
		});

		s.promptTemplates.forEach((tpl, i) => {
			new Setting(containerEl)
				.setName(`/${tpl.name}`)
				.setDesc(tpl.description || tpl.template.slice(0, 80))
				.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip(t("Remove"))
						.onClick(async () => {
							// Nicht-mutierend, um die geteilte Default-Liste nicht zu verändern.
							s.promptTemplates = s.promptTemplates.filter(
								(_, idx) => idx !== i
							);
							await this.plugin.saveSettings();
							this.display();
						})
				);
		});

		// --- Neue Vorlage anlegen ---
		const draft: PromptTemplate = { name: "", description: "", template: "" };

		new Setting(containerEl)
			.setName(t("New template"))
			.setDesc(t("Name (no spaces) and short description."))
			.addText((tg) =>
				tg.setPlaceholder(t("Name")).onChange((v) => (draft.name = v.trim()))
			)
			.addText((tg) =>
				tg
					.setPlaceholder(t("Description"))
					.onChange((v) => (draft.description = v.trim()))
			);

		new Setting(containerEl)
			.setName(t("Prompt text"))
			.setDesc(t('With placeholders, for example "Translate: {{input}}".'))
			.addTextArea((ta) => {
				ta.setPlaceholder(t("Translate into English:\n\n{{input}}")).onChange(
					(v) => (draft.template = v)
				);
				ta.inputEl.rows = 3;
				ta.inputEl.addClass("euridian-settings-textarea");
			})
			.addButton((b) =>
				b
					.setButtonText(t("Add"))
					.setCta()
					.onClick(async () => {
						if (!draft.name || !draft.template.trim()) {
							new Notice(t("Name and prompt text are required."));
							return;
						}
						const entry: PromptTemplate = {
							name: draft.name.replace(/\s+/g, "-"),
							description: draft.description,
							template: draft.template,
						};
						s.promptTemplates = [...s.promptTemplates, entry];
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
