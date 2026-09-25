/**
 * Euridian — Einstellungen: Defaults + Settings-Tab-UI.
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { EuridianApiClient } from "./api-client";
import { providerFor } from "./backend";
import { DEFAULT_BACKEND, PROVIDERS, VARIANT } from "../variant";
import { PROVIDER_DEFAULTS } from "../variant/settings";
import { searchWeb } from "./web-tools";
import { EuridianError, PluginSettings, PromptTemplate } from "./types";
import type EuridianPlugin from "./main";

/** Mitgelieferte Prompt-Vorlagen (Slash-Commands). Nutzer kann sie anpassen. */
export const DEFAULT_TEMPLATES: PromptTemplate[] = [
	{
		name: "zusammenfassen",
		description: "Aktuelle Notiz prägnant zusammenfassen",
		template:
			"Fasse die folgende Notiz prägnant in Stichpunkten zusammen:\n\n{{note}}",
	},
	{
		name: "übersetzen",
		description: "Text ins Englische übersetzen",
		template: "Übersetze den folgenden Text ins Englische:\n\n{{input}}",
	},
	{
		name: "verbessern",
		description: "Markierten Text stilistisch verbessern (natürliches Deutsch, keine KI-Muster)",
		template:
			"Verbessere Stil und Grammatik des folgenden Textes, ohne den Sinn zu verändern.\n" +
			"Vermeide dabei typische KI-Textmuster:\n" +
			"- Gedankenstriche sparsam einsetzen, nicht anstelle von Komma/Doppelpunkt häufen\n" +
			'- Keine Werbe-/Feiersprache ("spielt eine bedeutende Rolle", "unterstreicht die Bedeutung")\n' +
			'- Keine mechanischen Satzanfänge ("Darüber hinaus", "Zusätzlich", "Außerdem") in Folge\n' +
			'- Kein "nicht nur..., sondern auch..." als Standardfigur\n' +
			"- Schlichte Verben statt steifer Synonyme (schrieb statt verfasste, half statt leistete Unterstützung)\n" +
			"- Keine erzwungene Synonym-Rotation — Wortwiederholung ist erlaubt\n" +
			'- Fettdruck und Listen sparsam; kein Schema "**Begriff:** Erklärung"\n' +
			'- Kein "Fazit"- oder "Herausforderungen/Ausblick"-Block am Ende\n' +
			'- Keine Dialog-/Meta-Reste ("Hier ist der Text", "Ich hoffe das hilft")\n\n' +
			"Text:\n{{selection}}",
	},
	{
		name: "erklären",
		description: "Markierten Text einfach erklären",
		template:
			"Erkläre den folgenden Text einfach und verständlich:\n\n{{selection}}",
	},
	{
		name: "fortsetzen",
		description: "Notiz im gleichen Stil weiterschreiben",
		template:
			"Schreibe die folgende Notiz im gleichen Stil sinnvoll weiter:\n\n{{note}}",
	},
];

export const DEFAULT_SETTINGS: PluginSettings = {
	...PROVIDER_DEFAULTS,
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
				.setDesc("Welcher Dienst die Antworten liefert.")
				.addDropdown((dd) => {
					for (const p of PROVIDERS) dd.addOption(p.id, p.label);
					return dd
						.setValue(s.backend)
						.onChange(async (value) => {
							s.backend = value as PluginSettings["backend"];
							await this.plugin.saveSettings();
							this.display(); // UI neu rendern (zeigt passende Felder)
						});
				});
		}

		// --- Backend-spezifische Felder ---
		providerFor(s.backend).renderSettings(this);

		// --- Gemeinsame Verhaltens-Einstellungen ---
		containerEl.createEl("h3", { text: "Verhalten" });

		new Setting(containerEl)
			.setName("Vault-Agent")
			.setDesc(
				"Erlaubt dem Modell, Notizen zu lesen, zu durchsuchen, zu erstellen und zu ändern " +
					"(Function Calling). Löschen ist gesperrt. Modell muss Tool-Calling unterstützen."
			)
			.addToggle((t) =>
				t.setValue(s.enableVaultAgent).onChange(async (v) => {
					s.enableVaultAgent = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Bestätigung vor Schreibaktionen")
			.setDesc(
				"Fragt vor dem Erstellen, Anhängen oder Überschreiben von Notizen nach " +
					"(mit Vorschau). Lesen und Suchen bleiben ohne Rückfrage. Empfohlen, " +
					"verhindert ungefragte/halluzinierte Notizen."
			)
			.addToggle((t) =>
				t.setValue(s.confirmBeforeWrite).onChange(async (v) => {
					s.confirmBeforeWrite = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Aktuelle Notiz als Kontext")
			.setDesc(
				"Sendet den Inhalt der gerade geöffneten Notiz als System-Kontext mit."
			)
			.addToggle((t) =>
				t.setValue(s.includeCurrentNote).onChange(async (v) => {
					s.includeCurrentNote = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(`${VARIANT.name}-Instruktionsdatei`)
			.setDesc(
				"Vault-Pfad zu einer kurzen Instruktionsdatei für " + VARIANT.name + " " +
					"(z. B. Vault-Konventionen, Ordnerstruktur). Leer lassen = keine. " +
					"Standard: Euria.md im Vault-Root. NICHT die vault-weite CLAUDE.md " +
					"eintragen — große CLAUDE.md für andere Assistenten derailen den Agenten."
			)
			.addText((t) => {
				t.setPlaceholder("Euria.md")
					.setValue(s.euridianInstructionsPath)
					.onChange(async (v) => {
						s.euridianInstructionsPath = v.trim();
						await this.plugin.saveSettings();
					});
				t.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName("System-Prompt")
			.setDesc("Optionale Persona / Stilvorgabe für die KI.")
			.addTextArea((ta) => {
				ta.setPlaceholder("Du bist ein hilfreicher Assistent …")
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
				.setName("Thinking / Reasoning")
				.setDesc(
					'Aktiviert das "Nachdenken" des Modells. Aus → schneller & ' +
						"günstiger (reasoning_effort: none)."
				)
				.addToggle((t) =>
					t.setValue(s.enableThinking).onChange(async (v) => {
						s.enableThinking = v;
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl)
			.setName("Temperatur")
			.setDesc("0 = deterministisch, 2 = sehr kreativ.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 2, 0.1)
					.setValue(s.temperature)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.temperature = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max. Kontext-Nachrichten")
			.setDesc(
				"Älteste Nachrichten werden über dieser Grenze aus dem vollständigen Kontext entfernt (Token-Sparen)."
			)
			.addSlider((sl) =>
				sl
					.setLimits(2, 30, 1)
					.setValue(s.maxContextMessages)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.maxContextMessages = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Verlauf automatisch komprimieren")
			.setDesc(
				"Statt entfernte Nachrichten komplett zu verwerfen, per LLM-Kurzfassung " +
					"erhalten (ein zusätzlicher Hintergrund-Request, sobald die Grenze " +
					"erstmals überschritten wird). Analog zu Claude Codes Auto-Compact."
			)
			.addToggle((t) =>
				t.setValue(s.autoCompactHistory).onChange(async (v) => {
					s.autoCompactHistory = v;
					await this.plugin.saveSettings();
				})
			);

		this.renderWebSearchSettings();
		this.renderPromptTemplates();
	}

	/** Websuche (optional, unabhängig vom Vault-Agent) — Brave Search API. */
	private renderWebSearchSettings(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;

		containerEl.createEl("h3", { text: "Websuche (optional)" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Gibt dem Agenten ein Websuche-Werkzeug. Läuft immer lokal über " +
				"deinen Rechner — unabhängig davon, ob dein gewähltes Backend selbst " +
				"Internetzugang hat. Nützlich z. B. bei einem Server im internen " +
				"Netz ohne eigene Internetverbindung.",
		});

		new Setting(containerEl)
			.setName("Websuche aktivieren")
			.setDesc(
				'Fügt dem Agenten das Werkzeug "search_web" hinzu (Brave Search API).'
			)
			.addToggle((t) =>
				t.setValue(s.enableWebSearch).onChange(async (v) => {
					s.enableWebSearch = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Brave Search API-Key")
			.setDesc(
				"Kostenloser Key unter brave.com/search/api (Free-Tier: 2000 Anfragen/Monat)."
			)
			.addText((t) => {
				t.setPlaceholder("BSA...")
					.setValue(s.braveApiKey)
					.onChange(async (v) => {
						s.braveApiKey = v.trim();
						await this.plugin.saveSettings();
					});
				t.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Verbindung testen")
			.setDesc("Führt eine Testsuche aus.")
			.addButton((btn) =>
				btn
					.setButtonText("Testen")
					.onClick(async () => {
						if (!s.braveApiKey.trim()) {
							new Notice("Erst den API-Key eintragen.");
							return;
						}
						btn.setDisabled(true).setButtonText("Teste …");
						try {
							await searchWeb(s.braveApiKey.trim(), "test");
							new Notice("✓ Brave Search erreichbar.");
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

	/** Verwaltung der Prompt-Vorlagen (Slash-Commands): Liste + Löschen + Anlegen. */
	private renderPromptTemplates(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;

		containerEl.createEl("h3", { text: "Prompt-Vorlagen (Slash-Commands)" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Tippe / im Chat, um eine Vorlage einzufügen. Platzhalter: " +
				"{{input}} (Cursor für deinen Text), {{selection}} (markierter Text), " +
				"{{note}} (ganze Notiz), {{title}} (Notiztitel).",
		});

		s.promptTemplates.forEach((tpl, i) => {
			new Setting(containerEl)
				.setName(`/${tpl.name}`)
				.setDesc(tpl.description || tpl.template.slice(0, 80))
				.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip("Entfernen")
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
			.setName("Neue Vorlage")
			.setDesc("Name (ohne Leerzeichen) und Kurzbeschreibung.")
			.addText((t) =>
				t.setPlaceholder("name").onChange((v) => (draft.name = v.trim()))
			)
			.addText((t) =>
				t
					.setPlaceholder("Beschreibung")
					.onChange((v) => (draft.description = v.trim()))
			);

		new Setting(containerEl)
			.setName("Prompt-Text")
			.setDesc("Mit Platzhaltern, z. B. „Übersetze: {{input}}“.")
			.addTextArea((ta) => {
				ta.setPlaceholder("Übersetze ins Englische:\n\n{{input}}").onChange(
					(v) => (draft.template = v)
				);
				ta.inputEl.rows = 3;
				ta.inputEl.addClass("euridian-settings-textarea");
			})
			.addButton((b) =>
				b
					.setButtonText("Hinzufügen")
					.setCta()
					.onClick(async () => {
						if (!draft.name || !draft.template.trim()) {
							new Notice("Name und Prompt-Text sind nötig.");
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
