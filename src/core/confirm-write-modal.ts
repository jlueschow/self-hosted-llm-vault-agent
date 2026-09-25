/**
 * Euridian — Bestätigungs-Modal für schreibende Vault-Aktionen des Agenten.
 *
 * Wird vor `create_note` / `append_to_note` / `edit_note` gezeigt, wenn der
 * Nutzer „Bestätigung vor Schreibaktionen" aktiviert hat.
 *
 * Bei `edit_note` (Überschreiben einer bestehenden Notiz) zeigt es einen
 * Wort-Diff (rot = wird entfernt, grün = neu) + die Größenänderung, damit
 * stiller Datenverlust sichtbar wird. Sonst nur den zu schreibenden Inhalt.
 */

import { App, Modal, Setting, TFile } from "obsidian";
import { diffWords, renderDiffInto } from "./diff";
import { asNotePath } from "./vault-tools";

/** Eine schreibende Aktion, die bestätigt werden soll. */
export interface WriteAction {
	/** Werkzeugname: create_note | append_to_note | edit_note. */
	tool: string;
	path: string;
	content: string;
}

class ConfirmWriteModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private action: WriteAction,
		/** Aktueller Inhalt der Zielnotiz (nur für edit_note relevant), sonst null. */
		private currentContent: string | null,
		private onDecision: (ok: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("euridian-inline-modal");
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Schreibaktion bestätigen" });
		contentEl.createEl("div", {
			cls: "euridian-inline-label",
			text: this.headline(),
		});

		// edit_note auf bestehende Notiz → Diff zeigen (was geht verloren?).
		if (
			this.action.tool === "edit_note" &&
			this.currentContent !== null &&
			this.currentContent !== this.action.content
		) {
			const oldLen = this.currentContent.length;
			const newLen = this.action.content.length;
			const delta = newLen - oldLen;
			const warn =
				delta < 0
					? `  ⚠ ${oldLen} → ${newLen} Zeichen (${delta})`
					: `  ${oldLen} → ${newLen} Zeichen (+${delta})`;
			contentEl.createEl("div", {
				cls:
					"euridian-inline-label" +
					(delta < 0 ? " euridian-warn" : ""),
				text: "Änderungen (rot = entfernt, grün = neu):" + warn,
			});
			const diffEl = contentEl.createDiv({ cls: "euridian-diff" });
			renderDiffInto(diffEl, diffWords(this.currentContent, this.action.content));
		} else {
			contentEl.createEl("div", {
				cls: "euridian-inline-original",
				text: this.action.content || "(leerer Inhalt)",
			});
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Ablehnen").onClick(() => this.decide(false))
			)
			.addButton((b) =>
				b
					.setButtonText("Übernehmen")
					.setCta()
					.onClick(() => this.decide(true))
			);
	}

	onClose(): void {
		// Schließen ohne Klick = Ablehnen.
		this.decide(false);
		this.contentEl.empty();
	}

	private decide(ok: boolean): void {
		if (this.decided) return;
		this.decided = true;
		this.onDecision(ok);
		this.close();
	}

	private headline(): string {
		switch (this.action.tool) {
			case "create_note":
				return `Neue Notiz erstellen: ${this.action.path}`;
			case "append_to_note":
				return `An Notiz anhängen: ${this.action.path}`;
			case "edit_note":
				return `⚠ Notiz KOMPLETT überschreiben: ${this.action.path}`;
			default:
				return this.action.path;
		}
	}
}

/**
 * Zeigt das Modal und löst mit der Entscheidung des Nutzers auf. Liest für
 * `edit_note` den aktuellen Notiz-Inhalt, um einen Diff anzeigen zu können.
 */
export async function confirmWrite(
	app: App,
	action: WriteAction
): Promise<boolean> {
	let currentContent: string | null = null;
	if (action.tool === "edit_note") {
		const file = app.vault.getAbstractFileByPath(asNotePath(action.path));
		if (file instanceof TFile) {
			currentContent = await app.vault.cachedRead(file);
		}
	}
	return new Promise((resolve) => {
		new ConfirmWriteModal(app, action, currentContent, resolve).open();
	});
}

/**
 * Bestätigungs-Modal für „In Notiz einfügen", wenn im Zieleditor gerade
 * Text markiert ist. Der Chat merkt sich die zuletzt aktive Notiz auch dann,
 * wenn deren Editor längst nicht mehr im Fokus/Blick ist (Fokuswechsel zum
 * Chat-Panel) — die Auswahl dort kann veraltet und vom Nutzer vergessen sein.
 * Ohne diese Bestätigung würde `replaceSelection` sie kommentarlos
 * überschreiben (Security-Audit, 19.08.2026).
 */
class ConfirmInsertModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private noteName: string,
		private selectedText: string,
		private onDecision: (ok: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("euridian-inline-modal");
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "In Notiz einfügen?" });
		contentEl.createEl("div", {
			cls: "euridian-inline-label euridian-warn",
			text:
				`⚠ In "${this.noteName}" ist noch Text markiert — dieser wird ` +
				"durch die Antwort ersetzt. Ist das wirklich die richtige Notiz?",
		});
		contentEl.createEl("div", {
			cls: "euridian-inline-original",
			text: this.selectedText,
		});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Abbrechen").onClick(() => this.decide(false))
			)
			.addButton((b) =>
				b
					.setButtonText("Einfügen")
					.setCta()
					.onClick(() => this.decide(true))
			);
	}

	onClose(): void {
		this.decide(false);
		this.contentEl.empty();
	}

	private decide(ok: boolean): void {
		if (this.decided) return;
		this.decided = true;
		this.onDecision(ok);
		this.close();
	}
}

export function confirmInsert(
	app: App,
	noteName: string,
	selection: string
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmInsertModal(app, noteName, selection, resolve).open();
	});
}
