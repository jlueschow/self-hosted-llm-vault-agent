/**
 * Euridian — Plugin-Einstiegspunkt.
 *
 * Registriert die Chat-Seitenleiste, Ribbon-Icon, Commands und lädt/speichert
 * die Einstellungen. Hält keinen Chat-Zustand selbst — das macht die ChatView.
 */

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { migrateData, VARIANT } from "../variant";
import { InlineEditModal } from "./inline-edit";
import { DEFAULT_SETTINGS, EuridianSettingTab } from "./settings";
import { PluginSettings, SessionsState } from "./types";

/** Schlüssel, unter dem die Chat-Sessions in data.json liegen (neben Settings). */
const SESSIONS_KEY = "__euridianSessions";

export default class EuridianPlugin extends Plugin {
	settings!: PluginSettings;
	/** Persistierter Chat-Zustand (Tabs + Verlauf), null = noch keiner. */
	sessions: SessionsState | null = null;

	async onload(): Promise<void> {
		await this.loadPersisted();

		// Chat-View als eigenes Leaf (Seitenleiste) registrieren.
		this.registerView(
			VIEW_TYPE,
			(leaf) => new ChatView(leaf, this)
		);

		// Ribbon-Icon (BMP-sicheres Lucide-Icon, kein Farb-Emoji).
		this.addRibbonIcon("message-circle", `${VARIANT.name}: Chat öffnen`, () => {
			this.activateView();
		});

		// Command zum Öffnen der Chat-View.
		this.addCommand({
			id: "open-chat",
			name: "Chat öffnen",
			callback: () => this.activateView(),
		});

		// Command: markierten Text als Kontext an den Chat anhängen.
		this.addCommand({
			id: "attach-selection",
			name: "Auswahl als Kontext anhängen",
			editorCallback: (editor, ctx) => {
				const sel = editor.getSelection();
				if (!sel.trim()) {
					new Notice("Kein Text markiert.");
					return;
				}
				void this.addSelectionToChat(sel, ctx.file?.path ?? "Notiz");
			},
		});

		// Command: markierten Text per KI bearbeiten (mit Diff-Vorschau).
		this.addCommand({
			id: "inline-edit",
			name: "Inline-Edit: Auswahl mit KI bearbeiten",
			editorCallback: (editor) => {
				const sel = editor.getSelection();
				if (!sel.trim()) {
					new Notice("Bitte zuerst Text markieren.");
					return;
				}
				new InlineEditModal(this.app, this, editor, sel).open();
			},
		});

		// Editor-Kontextmenü (Rechtsklick auf Auswahl).
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
				const sel = editor.getSelection();
				if (!sel.trim()) return;
				menu.addItem((item) =>
					item
						.setTitle(`Zu ${VARIANT.name}-Chat hinzufügen`)
						.setIcon("highlighter")
						.onClick(() =>
							void this.addSelectionToChat(sel, ctx.file?.path ?? "Notiz")
						)
				);
				menu.addItem((item) =>
					item
						.setTitle(`Mit ${VARIANT.name} bearbeiten (Inline-Edit)`)
						.setIcon("wand")
						.onClick(() =>
							new InlineEditModal(this.app, this, editor, sel).open()
						)
				);
			})
		);

		this.addSettingTab(new EuridianSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian räumt registrierte Views/Leaves selbst auf. Kein manuelles
		// detachLeavesOfType() — das gilt als Anti-Pattern (würde den User-
		// Layout-Zustand zerstören).
	}

	/**
	 * Lädt Settings UND Chat-Sessions aus data.json.
	 * Beides liegt in einem JSON: Settings flach, Sessions unter SESSIONS_KEY.
	 */
	async loadPersisted(): Promise<void> {
		const data = migrateData(
			((await this.loadData()) ?? {}) as Record<string, unknown>
		);
		const sessions = data[SESSIONS_KEY] as SessionsState | undefined;
		delete data[SESSIONS_KEY];
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Wer bisher Brave mit Key nutzte, bleibt dabei (neuer Standard: DuckDuckGo).
		if (data.webSearchProvider === undefined && this.settings.braveApiKey) {
			this.settings.webSearchProvider = "brave";
		}
		this.sessions = sessions ?? null;
	}

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	/** Speichert den Chat-Zustand (von der ChatView aufgerufen). */
	async saveSessions(state: SessionsState): Promise<void> {
		this.sessions = state;
		await this.persist();
	}

	/** Schreibt Settings + Sessions gemeinsam zurück nach data.json. */
	private async persist(): Promise<void> {
		await this.saveData({ ...this.settings, [SESSIONS_KEY]: this.sessions });
	}

	/**
	 * Frischt alle offenen Chat-Ansichten auf, z. B. nach Änderungen im Settings-
	 * Tab (Modelllisten neu gescannt, Server/Key geändert). Die einzelnen Chats
	 * behalten dabei ihr Backend + Modell.
	 */
	refreshChatViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof ChatView) leaf.view.refreshFromSettings();
		}
	}

	/**
	 * Öffnet (falls nötig) die Chat-View und hängt die markierte Auswahl als
	 * Kontext an. Genutzt von Command und Editor-Kontextmenü.
	 */
	async addSelectionToChat(text: string, path: string): Promise<void> {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		const view = leaf?.view;
		if (view instanceof ChatView) {
			view.addSelectionAttachment(text, path);
		}
	}

	/**
	 * Öffnet die Chat-View in der rechten Seitenleiste (oder fokussiert sie,
	 * falls bereits offen).
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) workspace.revealLeaf(leaf);
	}
}
