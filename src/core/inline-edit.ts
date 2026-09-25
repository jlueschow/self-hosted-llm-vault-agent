/**
 * Euridian — Inline-Edit mit Diff-Vorschau.
 *
 * Markierten Text per KI überarbeiten lassen, das Ergebnis als Wort-Diff
 * vorschauen und erst nach Bestätigung in die Notiz übernehmen.
 *
 * Flow im Modal: Anweisung eingeben → KI streamt das Ergebnis → Wort-Diff
 * (LCS) mit „Übernehmen / Verwerfen / Neu".
 */

import { App, Editor, EditorPosition, Modal, Notice, Setting } from "obsidian";
import { EuridianApiClient } from "./api-client";
import { effectiveThinking, resolveEndpoint } from "./backend";
import { diffWords, renderDiffInto } from "./diff";
import { ApiMessage, EuridianError } from "./types";
import type EuridianPlugin from "./main";

const EDIT_SYSTEM_PROMPT =
	"Du bist ein präziser Text-Editor. Du bekommst einen Textausschnitt und eine " +
	"Anweisung. Gib AUSSCHLIESSLICH den überarbeiteten Text zurück — keine " +
	"Erklärung, keine Anführungszeichen, keinen Markdown-Codeblock, keine Vor- " +
	"oder Nachbemerkung. Behalte Sprache und Formatierung bei, sofern die " +
	"Anweisung nichts anderes verlangt.";

/** Entfernt einen umschließenden Markdown-Codeblock, falls das Modell einen baut. */
function stripFences(s: string): string {
	const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(s.trim());
	return m ? m[1] : s;
}

export class InlineEditModal extends Modal {
	private client = new EuridianApiClient();
	private instruction = "";
	private revised = "";
	private busy = false;
	private abort: AbortController | null = null;

	private readonly from: EditorPosition;
	private readonly to: EditorPosition;

	constructor(
		app: App,
		private plugin: EuridianPlugin,
		private editor: Editor,
		private original: string
	) {
		super(app);
		// Bereich der Auswahl festhalten — robuster als replaceSelection später.
		this.from = editor.getCursor("from");
		this.to = editor.getCursor("to");
	}

	onOpen(): void {
		this.modalEl.addClass("euridian-inline-modal");
		this.renderPrompt();
	}

	onClose(): void {
		this.abort?.abort();
		this.contentEl.empty();
	}

	// ------------------------------------------------------------- Phase 1: Prompt

	private renderPrompt(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Inline-Edit" });

		contentEl.createEl("div", {
			cls: "euridian-inline-label",
			text: "Markierter Text:",
		});
		contentEl.createEl("div", {
			cls: "euridian-inline-original",
			text: this.original,
		});

		new Setting(contentEl)
			.setName("Anweisung")
			.setDesc("Wie soll der Text geändert werden?")
			.addText((t) => {
				t.setPlaceholder("z. B. kürzer, formeller, ins Englische")
					.setValue(this.instruction)
					.onChange((v) => (this.instruction = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void this.run();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Abbrechen").onClick(() => this.close())
			)
			.addButton((b) =>
				b
					.setButtonText("Bearbeiten")
					.setCta()
					.onClick(() => void this.run())
			);
	}

	// --------------------------------------------------------- Phase 2: Generieren

	private async run(): Promise<void> {
		if (this.busy) return;
		if (!this.instruction.trim()) {
			new Notice("Bitte eine Anweisung eingeben.");
			return;
		}
		this.busy = true;
		this.revised = "";
		this.abort = new AbortController();

		const genEl = this.renderGenerating();

		const messages: ApiMessage[] = [
			{ role: "system", content: EDIT_SYSTEM_PROMPT },
			{
				role: "user",
				content: `Anweisung: ${this.instruction}\n\nText:\n${this.original}`,
			},
		];

		try {
			const endpoint = resolveEndpoint(this.plugin.settings);
			const result = await this.client.streamChat(
				endpoint,
				messages,
				effectiveThinking(this.plugin.settings),
				this.plugin.settings.temperature,
				{
					signal: this.abort.signal,
					onToken: (d) => {
						this.revised += d;
						genEl.setText(this.revised);
					},
				}
			);
			this.revised = stripFences((result.content || this.revised).trim());
			this.renderDiff();
		} catch (err) {
			if (err instanceof EuridianError && err.kind === "aborted") {
				this.renderPrompt();
			} else {
				const msg =
					err instanceof EuridianError ? err.message : String(err);
				this.renderError(msg);
			}
		} finally {
			this.busy = false;
			this.abort = null;
		}
	}

	private renderGenerating(): HTMLElement {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Inline-Edit" });
		contentEl.createEl("div", {
			cls: "euridian-inline-label",
			text: "Wird bearbeitet …",
		});
		const genEl = contentEl.createEl("div", {
			cls: "euridian-inline-original",
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Stop").onClick(() => this.abort?.abort())
		);
		return genEl;
	}

	// ------------------------------------------------------------- Phase 3: Diff

	private renderDiff(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Inline-Edit — Vorschau" });

		if (this.revised === this.original) {
			contentEl.createEl("div", {
				cls: "euridian-inline-label",
				text: "Keine Änderung vorgeschlagen.",
			});
		} else {
			const diffEl = contentEl.createDiv({ cls: "euridian-diff" });
			renderDiffInto(diffEl, diffWords(this.original, this.revised));
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Verwerfen").onClick(() => this.close())
			)
			.addButton((b) =>
				b.setButtonText("Neu").onClick(() => this.renderPrompt())
			)
			.addButton((b) =>
				b
					.setButtonText("Übernehmen")
					.setCta()
					.onClick(() => this.apply())
			);
	}

	private apply(): void {
		this.editor.replaceRange(this.revised, this.from, this.to);
		new Notice("Inline-Edit übernommen.");
		this.close();
	}

	private renderError(msg: string): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Inline-Edit — Fehler" });
		contentEl.createEl("div", { cls: "euridian-error", text: `⚠ ${msg}` });
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Schließen").onClick(() => this.close())
			)
			.addButton((b) =>
				b
					.setButtonText("Erneut")
					.setCta()
					.onClick(() => this.renderPrompt())
			);
	}
}
