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
import { t } from "./i18n";
import { ApiMessage, EuridianError } from "./types";
import type EuridianPlugin from "./main";

const EDIT_SYSTEM_PROMPT =
	"You are a precise text editor. You receive a text excerpt and an " +
	"instruction. Return ONLY the revised text: no explanation, no quotation " +
	"marks, no Markdown code block, no preface or closing remark. Keep the " +
	"language and formatting unless the instruction says otherwise.";

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
		contentEl.createEl("h3", { text: t("Inline edit") });

		contentEl.createDiv({
			cls: "euridian-inline-label",
			text: t("Selected text:"),
		});
		contentEl.createDiv({
			cls: "euridian-inline-original",
			text: this.original,
		});

		new Setting(contentEl)
			.setName(t("Instruction"))
			.setDesc(t("How should the text be changed?"))
			.addText((tg) => {
				tg.setPlaceholder(t("e.g. shorter, more formal, into English"))
					.setValue(this.instruction)
					.onChange((v) => (this.instruction = v));
				tg.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void this.run();
					}
				});
				window.setTimeout(() => tg.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(t("Cancel")).onClick(() => this.close())
			)
			.addButton((b) =>
				b
					.setButtonText(t("Edit"))
					.setCta()
					.onClick(() => void this.run())
			);
	}

	// --------------------------------------------------------- Phase 2: Generieren

	private async run(): Promise<void> {
		if (this.busy) return;
		if (!this.instruction.trim()) {
			new Notice(t("Please enter an instruction."));
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
				content: `Instruction: ${this.instruction}\n\nText:\n${this.original}`,
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
		contentEl.createEl("h3", { text: t("Inline edit") });
		contentEl.createDiv({
			cls: "euridian-inline-label",
			text: t("Editing …"),
		});
		const genEl = contentEl.createDiv({
			cls: "euridian-inline-original",
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText(t("Stop")).onClick(() => this.abort?.abort())
		);
		return genEl;
	}

	// ------------------------------------------------------------- Phase 3: Diff

	private renderDiff(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: t("Inline edit: preview") });

		if (this.revised === this.original) {
			contentEl.createDiv({
				cls: "euridian-inline-label",
				text: t("No change suggested."),
			});
		} else {
			const diffEl = contentEl.createDiv({ cls: "euridian-diff" });
			renderDiffInto(diffEl, diffWords(this.original, this.revised));
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(t("Discard")).onClick(() => this.close())
			)
			.addButton((b) =>
				b.setButtonText(t("Retry")).onClick(() => this.renderPrompt())
			)
			.addButton((b) =>
				b
					.setButtonText(t("Apply"))
					.setCta()
					.onClick(() => this.apply())
			);
	}

	private apply(): void {
		this.editor.replaceRange(this.revised, this.from, this.to);
		new Notice(t("Inline edit applied."));
		this.close();
	}

	private renderError(msg: string): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: t("Inline edit: error") });
		contentEl.createDiv({ cls: "euridian-error", text: `⚠ ${msg}` });
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(t("Close")).onClick(() => this.close())
			)
			.addButton((b) =>
				b
					.setButtonText(t("Try again"))
					.setCta()
					.onClick(() => this.renderPrompt())
			);
	}
}
