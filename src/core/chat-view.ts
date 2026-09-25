/**
 * Euridian — Chat-Seitenleiste (ItemView).
 *
 * Unterstützt mehrere Tabs (je eine eigene Konversation) und einen
 * Modell-Schnellwechsel im Header. API-/Backend-Wissen bleibt in
 * api-client/backend; diese View ist reine UI + Konversationszustand.
 */

import {
	App,
	FuzzySuggestModal,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { EuridianApiClient } from "./api-client";
import { VARIANT } from "../variant";
import {
	currentModelRef,
	effectiveThinking,
	isKnownBackend,
	providerFor,
	resolveEndpoint,
	settingsForRef,
} from "./backend";
import {
	describeToolCall,
	executeToolCall,
	getToolDefinitions,
	isWriteTool,
} from "./vault-tools";
import { executeWebToolCall, getWebToolDefinitions, isWebTool } from "./web-tools";
import { WriteAction, confirmInsert, confirmWrite } from "./confirm-write-modal";
import {
	ApiMessage,
	AttachedImage,
	ChatMessage,
	ContentPart,
	EuridianError,
	PromptTemplate,
	ResolvedEndpoint,
	SessionsState,
	Backend,
	ModelRef,
	ToolDefinition,
	TokenUsage,
} from "./types";
import type EuridianPlugin from "./main";

export const VIEW_TYPE = VARIANT.viewType;

/** Max. Agent-Iterationen (Tool-Aufruf → Antwort) pro Nutzer-Nachricht. */
const MAX_AGENT_ITERATIONS = 12;

/** Ab dieser Wartezeit ohne jedes Token vermuten wir eine Server-Warteschlange (siehe Denkt-Indikator). */
const QUEUE_HINT_THRESHOLD_S = 20;

/**
 * Hartes Sicherheitsnetz gegen Kontext-Explosion: kumulative Zeichen aus ALLEN
 * Werkzeug-Ergebnissen innerhalb EINER Nutzer-Anfrage (über alle Iterationen).
 * ~37.500 Token — sicherer Puffer unter kleinsten bekannten Server-Limits
 * (z. B. 65.536 Token bei manchen Deployments). Greift z. B. wenn ein Modell
 * versucht, viele/große Notizen nacheinander per read_note komplett zu lesen,
 * statt list_notes' Dateigröße zu nutzen (Prompt-Hinweis reicht nicht immer,
 * v. a. bei kleineren Modellen).
 */
const MAX_TOOL_OUTPUT_CHARS_PER_TURN = 150_000;

/**
 * Zusätzlich zum harten Zeichen-Budget: sobald die Werkzeug-Runden EINER
 * Anfrage (innerhalb von runAgentLoop) diese Größe überschreiten, werden alle
 * bis auf die letzte Runde per LLM-Kurzfassung komprimiert. Verhindert, dass
 * lange Multi-Schritt-Analysen (z. B. "analysiere die ganze Vault") den
 * Server-Kontext sprengen, obwohl jedes einzelne Tool-Ergebnis für sich unter
 * dem Zeichen-Budget bleibt — analog zu Claude Codes Auto-Compact.
 */
const WORKING_COMPACT_THRESHOLD_CHARS = 100_000;

/** Max. Zeichen pro angehängter Textdatei (vermeidet Token-Explosion). */
const MAX_ATTACHMENT_CHARS = 50_000;

/** Max. Zeichen der automatisch mitgeschickten aktuellen Notiz (gleiche Deckelung wie read_note). */
const MAX_CURRENT_NOTE_CHARS = 40_000;

/**
 * Max. Zeichen der Euridian-Instruktionsdatei. Ohne Limit würde eine große
 * Datei (z. B. aus einer synchronisierten/geteilten Vault) bei JEDER
 * Nachricht unbegrenzt Kontext/Kosten verursachen — im Gegensatz zu jeder
 * anderen Inhaltsquelle im Code war dieser Pfad bisher der einzige ohne
 * Deckelung (Security-Audit, 19.08.2026).
 */
const MAX_INSTRUCTIONS_CHARS = 40_000;

/** Max. Bildgröße in Bytes (Vision-APIs limitieren ohnehin). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Bild-Endungen → werden multimodal (image_url) gesendet. */
const IMAGE_EXTS = new Set([
	"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg",
]);

/** Text-/Code-Endungen → werden als Text eingebettet. */
const TEXT_EXTS = new Set([
	"md", "markdown", "csv", "tsv", "txt", "json", "yaml", "yml", "xml",
	"html", "htm", "css", "js", "ts", "jsx", "tsx", "py", "java", "c",
	"cpp", "h", "hpp", "sh", "bash", "log", "ini", "toml", "rs", "go",
	"rb", "php", "sql", "r", "swift", "kt",
]);

/** Klassifiziert eine Datei anhand Endung/MIME-Typ. */
function classifyFile(name: string, mime: string): "image" | "text" | null {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (IMAGE_EXTS.has(ext) || mime.startsWith("image/")) return "image";
	if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) return "text";
	return null;
}

/** Ein ausstehender Anhang für die nächste Nachricht. */
type PendingAttachment =
	| { kind: "text"; name: string; path: string; content: string }
	| { kind: "image"; name: string; path: string; dataUrl: string }
	| { kind: "selection"; name: string; path: string; content: string };

/** Datei-Picker für Anhänge: durchsucht alle Markdown-Dateien im Vault. */
class FileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onChoose: (file: TFile) => void) {
		super(app);
		this.setPlaceholder("Datei suchen und anhängen…");
	}
	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.sort((a, b) => a.path.localeCompare(b.path));
	}
	getItemText(item: TFile): string {
		return item.path;
	}
	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

/** Ein Eintrag im Suggest-Popup (Slash-Command oder @mention). */
interface SuggestItem {
	/** Hauptzeile, z. B. "/zusammenfassen" oder "Meine Notiz". */
	label: string;
	/** Zweitzeile (Beschreibung / Pfad). */
	sub?: string;
	/** Wird bei Auswahl ausgeführt. */
	apply: () => void | Promise<void>;
}

/**
 * Baut den System-Prompt für die aktuell aktiven Werkzeug-Fähigkeiten.
 * Vault-Agent und Websuche sind unabhängig schaltbar — die "kein Internet"-
 * Warnung kehrt sich um, sobald Websuche aktiv ist, sonst würde der Agent
 * search_web nie proaktiv nutzen.
 */
function buildAgentSystemPrompt(useVault: boolean, useWeb: boolean): string {
	// Absatz 1: Identität + Fähigkeiten (Sätze, einzeilig verkettet).
	const intro: string[] = [VARIANT.intro];

	if (useVault) {
		intro.push(
			"Du hast über Werkzeuge echten Zugriff auf den Vault des Nutzers: Markdown-Notizen " +
				"lesen, durchsuchen, auflisten, erstellen, ergänzen und ändern. " +
				"Zusätzlich kannst du über list_documents und read_document den Textinhalt von " +
				"PDF-, Word- (.docx) und PowerPoint- (.pptx) Dateien im Vault auslesen — diese " +
				"tauchen nicht bei list_notes/search_vault auf, sondern nur bei list_documents. " +
				"Nutze diese Werkzeuge proaktiv und selbstständig, statt zu behaupten, du hättest keinen Zugriff. " +
				"Alle Pfade sind relativ zum Vault-Root. Wenn du einen Pfad nicht kennst, nutze search_vault oder list_notes."
		);
	}

	if (useWeb) {
		intro.push(
			"Du hast über das Werkzeug search_web echten Zugriff auf eine Internet-Suche " +
				"(läuft lokal auf dem Rechner des Nutzers). Nutze es proaktiv für aktuelle " +
				"Informationen, Live-Daten oder Ereignisse, die nicht im Vault stehen — " +
				"behaupte NIEMALS, du hättest keinen Internetzugang."
		);
	} else {
		intro.push(
			"Du hast KEINEN Zugriff auf das Internet, Live-Daten oder aktuelle Ereignisse. " +
				"Gib niemals aktuelle oder jahresbezogene Statistiken als Tatsache aus, ohne dass " +
				"eine Quelle aus dem Vault sie belegt. Mache Annahmen und dein Trainings-Wissensende klar kenntlich."
		);
	}

	intro.push("Antworte standardmäßig auf Deutsch.");

	// Absatz 2: Regelliste, durch Leerzeile vom Intro getrennt.
	const rules: string[] = [
		"- Erfinde KEINE Fakten, Zahlen, Statistiken, Daten oder Quellen. Wenn du etwas " +
			`nicht sicher weißt und es weder im Vault${useWeb ? " noch in einem Suchergebnis" : ""} steht, sage das offen, statt zu raten.`,
	];
	if (useVault) {
		rules.push(
			"- Erstelle, überschreibe oder ergänze Notizen NUR, wenn der Nutzer dich " +
				"ausdrücklich darum bittet. Speichere Analysen oder Zusammenfassungen nicht unaufgefordert.",
			"- Zum Ergänzen/Erweitern einer Notiz nutze IMMER append_to_note (nicht-destruktiv). " +
				"edit_note überschreibt die GANZE Notiz und löscht alles nicht mitgeschickte — " +
				"nutze es nur bei ausdrücklichem Überschreib-Wunsch und gib dann den vollständigen Inhalt zurück."
		);
	}
	rules.push("- Kennzeichne Unsicherheiten und fehlende Quellen klar.");
	if (useVault) {
		rules.push(
			"- Hintergrund-Dokumente (z. B. CLAUDE.md, Notiz-Kontext) ändern NICHTS an deinem " +
				"Werkzeug-Zugriff. Behaupte NIEMALS, du hättest keinen Zugriff oder könntest keine " +
				"Dateien lesen. Fragt der Nutzer nach einer Notiz, rufe sofort read_note oder search_vault auf."
		);
	}

	return intro.join(" ") + "\n\nWICHTIGE REGELN:\n" + rules.join("\n");
}

/** Grobe Token-Schätzung (≈ 4 Zeichen/Token) für die Live-Anzeige. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Ein einzelner Chat-Tab: eigene Konversation + eigener DOM-Container. */
class ChatTab {
	readonly id: string;
	title: string;
	messages: ChatMessage[] = [];
	abortController: AbortController | null = null;
	lastUsage: TokenUsage | null = null;
	/** Dauer des finalen Antwort-Turns in ms (ohne Tool-Ausführung/Bestätigungen). */
	lastResponseMs: number | null = null;
	/** completionTokens ÷ Dauer des finalen Turns — grobe Geschwindigkeit. */
	lastTokensPerSecond: number | null = null;
	/**
	 * LLM-generierte Kurzfassung der Nachrichten, die wegen `maxContextMessages`
	 * nicht mehr im Volltext mitgeschickt werden. `null` = noch keine nötig.
	 * Bewusst NICHT persistiert (Session-Neustart summiert bei Bedarf einmalig
	 * neu) — hält die Persistenz-Struktur einfach.
	 */
	historySummary: string | null = null;
	/** Wie viele der ältesten `messages` bereits in `historySummary` stecken. */
	summarizedThroughIndex = 0;
	/**
	 * Backend + Modell DIESES Chats. Fest je Tab, unabhängig von den globalen
	 * Settings und von anderen Tabs/Fenstern — sonst wirkt ein Modellwechsel in
	 * einem Chat lautlos auf alle anderen (und ein Backend-Wechsel in den Settings
	 * ließ Dropdown und tatsächliche Anfrage auseinanderlaufen).
	 */
	modelRef: ModelRef;
	/**
	 * Modelle (Schlüssel `backend|modell`), die Bilder komplett abgelehnt haben.
	 * Für sie werden Bilder aus dem Verlauf nicht mehr mitgeschickt. Bewusst nicht
	 * persistiert (wie historySummary): nach einem Neustart genügt ein einmaliger
	 * automatischer Wiederholungsversuch.
	 */
	imagesRejectedFor = new Set<string>();
	/** Modelle mit Bild-Obergrenze pro Anfrage (Schlüssel `backend|modell` → N). */
	imageLimitFor = new Map<string, number>();
	/** Scroll-Container mit den Nachrichten-Bubbles dieses Tabs. */
	containerEl: HTMLElement;

	constructor(
		id: string,
		title: string,
		containerEl: HTMLElement,
		modelRef: ModelRef
	) {
		this.id = id;
		this.title = title;
		this.containerEl = containerEl;
		this.modelRef = modelRef;
	}

	get isStreaming(): boolean {
		return this.abortController !== null;
	}
}

export class ChatView extends ItemView {
	private plugin: EuridianPlugin;
	private client = new EuridianApiClient();

	private tabs: ChatTab[] = [];
	private activeTabId = "";
	private tabCounter = 0;

	// --- DOM-Referenzen ---
	private modelSelectEl!: HTMLSelectElement;
	private tabBarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private attachmentsEl!: HTMLElement;
	private dropOverlayEl!: HTMLElement;
	/** Zähler für verschachtelte dragenter/dragleave-Events. */
	private dragDepth = 0;

	/**
	 * Letztes Leaf mit einer MarkdownView, BEVOR der Fokus in dieses Panel
	 * wanderte. `getActiveViewOfType(MarkdownView)` liefert `null`, sobald
	 * Euridians eigenes Sidebar-Panel aktiv wird (z. B. durch Klick ins
	 * Eingabefeld) — genau dann, wenn Nutzer typischerweise mit der Notiz
	 * interagieren wollen (Auswahl anhängen, Vorlage mit {{selection}},
	 * Antwort einfügen). Ohne diesen Fallback brechen all diese Features
	 * lautlos ab, sobald der Chat fokussiert ist.
	 */
	private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;

	// --- Suggest-Popup (Slash-Commands „/" und @mention „@") ---
	private suggestEl: HTMLElement | null = null;
	private suggestOpen = false;
	private suggestItems: SuggestItem[] = [];
	private suggestActive = 0;

	/** Anhänge für die nächste Nachricht (wird nach dem Senden geleert). */
	private pendingAttachments: PendingAttachment[] = [];

	/** Lazy per `/v1/models` geladene Modelllisten je Backend. */
	private scannedModels = new Map<Backend, string[]>();

	constructor(leaf: WorkspaceLeaf, plugin: EuridianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return `${VARIANT.name} Chat`;
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("euridian-view");

		this.buildHeader(root);
		this.tabBarEl = root.createDiv({ cls: "euridian-tabbar" });
		this.bodyEl = root.createDiv({ cls: "euridian-body" });
		this.buildInputArea(root);
		this.setupDragAndDrop(root);
		this.trackActiveMarkdownLeaf();

		// Gespeicherte Tabs wiederherstellen oder mit einem leeren Tab starten.
		await this.restoreSessions();
		this.populateModelSelect();
	}

	/** Merkt sich fortlaufend das zuletzt aktive Markdown-Leaf — siehe lastActiveMarkdownLeaf. */
	private trackActiveMarkdownLeaf(): void {
		const initial = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.lastActiveMarkdownLeaf =
			initial?.leaf ?? this.app.workspace.getLeavesOfType("markdown")[0] ?? null;

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.lastActiveMarkdownLeaf = leaf;
				}
			})
		);
	}

	/** Liefert die Notiz, mit der zuletzt gearbeitet wurde — auch wenn der Chat gerade fokussiert ist. */
	private getContextMarkdownView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const leafView = this.lastActiveMarkdownLeaf?.view;
		return leafView instanceof MarkdownView ? leafView : null;
	}

	/** Externe Dateien per Drag & Drop aus dem Finder annehmen. */
	private setupDragAndDrop(root: HTMLElement): void {
		this.dropOverlayEl = root.createDiv({
			cls: "euridian-drop-overlay is-hidden",
		});
		const hint = this.dropOverlayEl.createDiv({ cls: "euridian-drop-hint" });
		setIcon(hint.createSpan({ cls: "euridian-drop-icon" }), "upload");
		hint.createDiv({ text: "Dateien hier ablegen" });
		hint.createDiv({
			cls: "euridian-drop-sub",
			text: "Text- und Bilddateien werden in den Kontext aufgenommen",
		});

		const hasFiles = (evt: DragEvent): boolean =>
			Array.from(evt.dataTransfer?.types ?? []).includes("Files");

		this.registerDomEvent(root, "dragenter", (evt) => {
			if (!hasFiles(evt)) return;
			evt.preventDefault();
			this.dragDepth++;
			this.dropOverlayEl.removeClass("is-hidden");
		});
		this.registerDomEvent(root, "dragover", (evt) => {
			if (!hasFiles(evt)) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "copy";
		});
		this.registerDomEvent(root, "dragleave", (evt) => {
			if (!hasFiles(evt)) return;
			this.dragDepth = Math.max(0, this.dragDepth - 1);
			if (this.dragDepth === 0) this.dropOverlayEl.addClass("is-hidden");
		});
		this.registerDomEvent(root, "drop", (evt) => {
			this.dragDepth = 0;
			this.dropOverlayEl.addClass("is-hidden");
			if (!hasFiles(evt)) return;
			evt.preventDefault();
			void this.handleExternalDrop(evt);
		});
	}

	async onClose(): Promise<void> {
		for (const tab of this.tabs) tab.abortController?.abort();
	}

	private get activeTab(): ChatTab {
		return (
			this.tabs.find((t) => t.id === this.activeTabId) ?? this.tabs[0]
		);
	}

	// ---------------------------------------------------------------- UI-Aufbau

	private buildHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "euridian-header" });
		header.createSpan({ cls: "euridian-header-brand", text: VARIANT.name });

		// Modell-Schnellwechsel.
		this.modelSelectEl = header.createEl("select", {
			cls: "euridian-model-select dropdown",
		});
		this.modelSelectEl.addEventListener("change", async () => {
			await this.onModelChanged(this.modelSelectEl.value);
		});
		// Beim Öffnen des Dropdowns ggf. Modelle nachladen (Ollama/eigener Server).
		this.modelSelectEl.addEventListener("focus", () => {
			const backend = this.activeTab.modelRef.backend;
			if (providerFor(backend).lazyScan && !this.scannedModels.has(backend)) {
				void this.loadModels(backend);
			}
		});
	}

	private buildInputArea(root: HTMLElement): void {
		const wrap = root.createDiv({ cls: "euridian-input-wrap" });

		// Suggest-Popup für „/" und „@" (schwebt über dem Eingabefeld).
		this.suggestEl = wrap.createDiv({
			cls: "euridian-suggest-popup is-hidden",
		});

		// Chips der ausstehenden Datei-Anhänge (anfangs versteckt).
		this.attachmentsEl = wrap.createDiv({
			cls: "euridian-attachments is-hidden",
		});

		this.inputEl = wrap.createEl("textarea", {
			cls: "euridian-input",
			attr: {
				placeholder:
					"Frag etwas … (/ Vorlagen, @ Notizen, Enter sendet, Shift+Enter = Zeile)",
			},
		});
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", (evt) => {
			// Bei offenem Suggest-Popup fängt es die Navigationstasten ab.
			if (this.suggestOpen) {
				if (evt.key === "ArrowDown") {
					evt.preventDefault();
					this.moveSuggest(1);
					return;
				}
				if (evt.key === "ArrowUp") {
					evt.preventDefault();
					this.moveSuggest(-1);
					return;
				}
				if (evt.key === "Enter" || evt.key === "Tab") {
					evt.preventDefault();
					void this.acceptSuggest();
					return;
				}
				if (evt.key === "Escape") {
					evt.preventDefault();
					this.closeSuggest();
					return;
				}
			}
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				this.onSendOrStop();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.updateStatus();
			this.updateSuggest();
		});
		// Cursor-Bewegung (Pfeiltasten) bei GESCHLOSSENEM Popup → @mention neu prüfen.
		// Bei offenem Popup steuern die Pfeile die Auswahl (im keydown behandelt).
		this.inputEl.addEventListener("keyup", (evt) => {
			if (
				!this.suggestOpen &&
				(evt.key.startsWith("Arrow") || evt.key === "Home" || evt.key === "End")
			) {
				this.updateSuggest();
			}
		});
		this.inputEl.addEventListener("click", () => this.updateSuggest());
		// Klick außerhalb schließt das Popup (kurze Verzögerung wg. Item-Klick).
		this.inputEl.addEventListener("blur", () => {
			window.setTimeout(() => this.closeSuggest(), 120);
		});

		const bottom = wrap.createDiv({ cls: "euridian-input-bottom" });
		this.statusEl = bottom.createDiv({ cls: "euridian-status" });

		const selectionBtn = bottom.createEl("button", {
			cls: "euridian-icon-btn",
			attr: { "aria-label": "Markierten Text als Kontext anhängen" },
		});
		setIcon(selectionBtn, "highlighter");
		selectionBtn.onclick = () => this.attachCurrentSelection();

		const attachBtn = bottom.createEl("button", {
			cls: "euridian-icon-btn",
			attr: { "aria-label": "Datei anhängen" },
		});
		setIcon(attachBtn, "paperclip");
		attachBtn.onclick = () => this.openFilePicker();

		this.sendBtn = bottom.createEl("button", {
			cls: "euridian-send-btn mod-cta",
			text: "Senden",
		});
		this.sendBtn.onclick = () => this.onSendOrStop();
	}

	// ----------------------------------------- Suggest-Popup („/" und „@mention")

	/** Prüft die Eingabe auf `/command` (Zeilenanfang) oder `@datei` (vor Cursor). */
	private updateSuggest(): void {
		const val = this.inputEl.value;

		// 1) Slash-Command: nur am Zeilenanfang, solange nur der Befehl getippt wird.
		const slashM = /^\/([^\s\n]*)$/.exec(val);
		if (slashM) {
			this.buildSlashItems(slashM[1].toLowerCase());
			return;
		}

		// 2) @mention: ein @-Token unmittelbar vor dem Cursor.
		const pos = this.inputEl.selectionStart ?? val.length;
		const before = val.slice(0, pos);
		const atM = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (atM) {
			const tokenStart = pos - atM[1].length - 1; // Position des "@"
			this.buildMentionItems(atM[1].toLowerCase(), tokenStart, pos);
			return;
		}

		this.closeSuggest();
	}

	/** Baut die Vorschläge für Slash-Commands (Prompt-Vorlagen). */
	private buildSlashItems(query: string): void {
		const templates = this.plugin.settings.promptTemplates ?? [];
		const matches = templates.filter((t) =>
			t.name.toLowerCase().includes(query)
		);
		if (matches.length === 0) {
			this.closeSuggest();
			return;
		}
		this.suggestItems = matches.map((tpl) => ({
			label: `/${tpl.name}`,
			sub: tpl.description,
			apply: () => this.applyTemplate(tpl),
		}));
		this.openSuggest();
	}

	/** Baut die Vorschläge für @mention (Vault-Notizen). */
	private buildMentionItems(
		query: string,
		tokenStart: number,
		tokenEnd: number
	): void {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter(
				(f) =>
					f.basename.toLowerCase().includes(query) ||
					f.path.toLowerCase().includes(query)
			)
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 12);

		if (files.length === 0) {
			this.closeSuggest();
			return;
		}
		this.suggestItems = files.map((f) => ({
			label: f.basename,
			sub: f.path,
			apply: () => this.applyMention(f, tokenStart, tokenEnd),
		}));
		this.openSuggest();
	}

	private openSuggest(): void {
		this.suggestActive = 0;
		this.suggestOpen = true;
		this.renderSuggest();
	}

	private renderSuggest(): void {
		if (!this.suggestEl) return;
		this.suggestEl.empty();
		this.suggestEl.removeClass("is-hidden");

		this.suggestItems.forEach((item, i) => {
			const el = this.suggestEl!.createDiv({
				cls:
					"euridian-suggest-item" +
					(i === this.suggestActive ? " is-active" : ""),
			});
			el.createSpan({ cls: "euridian-suggest-label", text: item.label });
			if (item.sub) {
				el.createSpan({ cls: "euridian-suggest-sub", text: item.sub });
			}
			// mousedown statt click: hält den Fokus im Textfeld.
			el.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.suggestActive = i;
				void this.acceptSuggest();
			});
		});
	}

	private moveSuggest(delta: number): void {
		const n = this.suggestItems.length;
		if (n === 0) return;
		this.suggestActive = (this.suggestActive + delta + n) % n;
		this.renderSuggest();
	}

	private async acceptSuggest(): Promise<void> {
		const item = this.suggestItems[this.suggestActive];
		this.closeSuggest();
		if (item) await item.apply();
	}

	private closeSuggest(): void {
		this.suggestOpen = false;
		this.suggestItems = [];
		if (this.suggestEl) {
			this.suggestEl.empty();
			this.suggestEl.addClass("is-hidden");
		}
	}

	/** Übernimmt eine Prompt-Vorlage: expandiert sie in das Eingabefeld. */
	private applyTemplate(tpl: PromptTemplate): void {
		const { text, cursor } = this.expandTemplate(tpl);
		this.inputEl.value = text;
		this.inputEl.focus();
		const pos = cursor ?? text.length;
		this.inputEl.setSelectionRange(pos, pos);
		this.updateStatus();
	}

	/** Übernimmt eine @mention: entfernt das @-Token und hängt die Notiz an. */
	private async applyMention(
		file: TFile,
		tokenStart: number,
		tokenEnd: number
	): Promise<void> {
		const v = this.inputEl.value;
		this.inputEl.value = v.slice(0, tokenStart) + v.slice(tokenEnd);
		this.inputEl.focus();
		this.inputEl.setSelectionRange(tokenStart, tokenStart);
		await this.addVaultAttachment(file);
		this.updateStatus();
	}

	/**
	 * Ersetzt die Platzhalter einer Vorlage. {{input}} markiert die Cursor-
	 * Position für die Nutzereingabe (zurückgegeben als `cursor`).
	 */
	private expandTemplate(tpl: PromptTemplate): {
		text: string;
		cursor: number | null;
	} {
		const view = this.getContextMarkdownView();
		const selection = view?.editor.getSelection() ?? "";
		const note = view?.editor.getValue() ?? "";
		const title = view?.file?.basename ?? "";

		let text = tpl.template
			.replace(/\{\{selection\}\}/g, selection)
			.replace(/\{\{note\}\}/g, note)
			.replace(/\{\{title\}\}/g, title);

		const idx = text.indexOf("{{input}}");
		let cursor: number | null = null;
		if (idx !== -1) {
			cursor = idx;
			text = text.replace(/\{\{input\}\}/g, "");
		}
		return { text, cursor };
	}

	// ------------------------------------------------------------------- Tabs

	private addTab(): void {
		const id = `tab-${++this.tabCounter}`;
		const container = this.bodyEl.createDiv({ cls: "euridian-messages" });
		const tab = new ChatTab(
			id,
			`Chat ${this.tabCounter}`,
			container,
			currentModelRef(this.plugin.settings)
		);
		this.tabs.push(tab);
		this.activeTabId = id;
		this.renderEmptyState(tab);
		this.renderTabBar();
		this.showActiveTab();
		this.populateModelSelect();
		this.syncInputState();
		this.updateStatus();
		this.persist();
	}

	private closeTab(id: string): void {
		const idx = this.tabs.findIndex((t) => t.id === id);
		if (idx === -1) return;

		const tab = this.tabs[idx];
		tab.abortController?.abort();
		tab.containerEl.remove();
		this.tabs.splice(idx, 1);

		// Nie ohne Tab dastehen.
		if (this.tabs.length === 0) {
			this.addTab();
			return;
		}

		// Aktiven Tab nachziehen.
		if (this.activeTabId === id) {
			const next = this.tabs[Math.max(0, idx - 1)];
			this.activeTabId = next.id;
		}
		this.renderTabBar();
		this.showActiveTab();
		this.populateModelSelect();
		this.syncInputState();
		this.updateStatus();
		this.persist();
	}

	private switchTab(id: string): void {
		if (this.activeTabId === id) return;
		this.activeTabId = id;
		this.renderTabBar();
		this.showActiveTab();
		this.populateModelSelect();
		this.syncInputState();
		this.updateStatus();
		this.persist();
	}

	private renderTabBar(): void {
		this.tabBarEl.empty();

		for (const tab of this.tabs) {
			const tabEl = this.tabBarEl.createDiv({
				cls:
					"euridian-tab" +
					(tab.id === this.activeTabId ? " is-active" : ""),
			});
			tabEl.createSpan({ cls: "euridian-tab-title", text: tab.title });
			tabEl.addEventListener("click", () => this.switchTab(tab.id));

			// Schließen-Knopf (nur wenn mehr als ein Tab oder zum Leeren).
			const closeEl = tabEl.createSpan({ cls: "euridian-tab-close" });
			setIcon(closeEl, "x");
			closeEl.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.closeTab(tab.id);
			});
		}

		// "+"-Knopf.
		const addEl = this.tabBarEl.createDiv({
			cls: "euridian-tab-add",
			attr: { "aria-label": "Neuer Tab" },
		});
		setIcon(addEl, "plus");
		addEl.addEventListener("click", () => this.addTab());
	}

	/** Zeigt nur den aktiven Tab-Container, blendet die anderen aus. */
	private showActiveTab(): void {
		for (const tab of this.tabs) {
			tab.containerEl.toggleClass("is-hidden", tab.id !== this.activeTabId);
		}
		this.scrollToBottom();
	}

	// ------------------------------------------------------------- Persistenz

	/** Stellt gespeicherte Tabs wieder her — oder startet mit einem leeren Tab. */
	private async restoreSessions(): Promise<void> {
		const saved = this.plugin.sessions;
		if (!saved || saved.tabs.length === 0) {
			this.addTab();
			return;
		}

		this.tabCounter = saved.tabCounter ?? saved.tabs.length;

		for (const session of saved.tabs) {
			const container = this.bodyEl.createDiv({ cls: "euridian-messages" });
			const savedRef = session.modelRef;
			const validBackend = isKnownBackend(savedRef?.backend);
			const tab = new ChatTab(
				session.id,
				session.title,
				container,
				savedRef && validBackend && typeof savedRef.model === "string"
					? { backend: savedRef.backend, model: savedRef.model }
					: currentModelRef(this.plugin.settings)
			);
			tab.messages = session.messages.slice();
			this.tabs.push(tab);
			await this.renderTabMessages(tab);
		}

		this.activeTabId =
			saved.activeTabId && this.tabs.some((t) => t.id === saved.activeTabId)
				? saved.activeTabId
				: this.tabs[0].id;

		this.renderTabBar();
		this.showActiveTab();
		this.syncInputState();
		this.updateStatus();
	}

	/** Rendert den gespeicherten Verlauf eines Tabs (User-Text, Assistant-Markdown). */
	private async renderTabMessages(tab: ChatTab): Promise<void> {
		tab.containerEl.empty();
		if (tab.messages.length === 0) {
			this.renderEmptyState(tab);
			return;
		}
		for (const m of tab.messages) {
			if (m.role === "user") {
				this.appendMessageBubble(
					tab,
					"user",
					m.displayContent ?? m.content,
					m.attachedFiles,
					m.images
				);
			} else if (m.role === "assistant") {
				const { contentEl, bubbleEl } = this.appendMessageBubble(
					tab,
					"assistant",
					""
				);
				await this.renderMarkdown(contentEl, m.content);
				this.addAssistantActions(bubbleEl, m.content);
			}
		}
	}

	/** Schreibt den aktuellen Tab-Zustand zur Persistenz an das Plugin. */
	private persist(): void {
		const state: SessionsState = {
			tabs: this.tabs.map((t) => ({
				id: t.id,
				title: t.title,
				messages: t.messages,
				modelRef: t.modelRef,
			})),
			activeTabId: this.activeTabId,
			tabCounter: this.tabCounter,
		};
		void this.plugin.saveSessions(state);
	}

	// --------------------------------------------------------------- Modelle

	/** Modell des AKTIVEN Tabs (nicht der globalen Settings). */
	private currentModel(): string {
		return this.activeTab.modelRef.model;
	}

	/**
	 * Befüllt das Modell-Dropdown für Backend + Modell des aktiven Tabs. Muss bei
	 * jedem Tab-Wechsel und nach Änderungen in den Settings neu laufen (siehe
	 * refreshFromSettings), damit die Anzeige nie vom tatsächlichen Chat abweicht.
	 */
	private populateModelSelect(): void {
		const s = this.plugin.settings;
		const backend = this.activeTab.modelRef.backend;
		const select = this.modelSelectEl;
		select.empty();
		select.title = `Backend dieses Chats: ${this.backendLabel(backend)}`;

		const current = this.currentModel();
		// Reihenfolge: gecachte Liste aus den Settings (kann vom Settings-Tab
		// aktualisiert worden sein, während dieser Chat schon offen war) → eigener
		// Lazy-Load-Cache → aktuelles. Settings zuerst, sonst bleibt das Dropdown
		// nach einem Rescan im Settings-Tab dauerhaft veraltet.
		const cached = providerFor(backend).cachedModels(s);
		const names: string[] = cached.length
			? cached.slice()
			: (this.scannedModels.get(backend) ?? (current ? [current] : []));

		// Aktuelles Modell sicher als Option vorhanden.
		if (current && !names.includes(current)) names.unshift(current);

		if (names.length === 0) {
			const opt = select.createEl("option", {
				value: "",
				text: "— kein Modell —",
			});
			opt.disabled = true;
			return;
		}

		for (const name of names) {
			select.createEl("option", { value: name, text: this.shortModel(name) });
		}
		select.value = current;
	}

	/** Kürzt lange Modellnamen fürs Dropdown (Vendor-Präfix weg). */
	private shortModel(name: string): string {
		const slash = name.lastIndexOf("/");
		return slash >= 0 ? name.slice(slash + 1) : name;
	}

	private async onModelChanged(value: string): Promise<void> {
		if (!value) return;
		// Nur der aktive Chat wechselt sein Modell. Die globalen Settings bleiben
		// unberührt — sie sind der Standard für NEUE Chats.
		this.activeTab.modelRef = { ...this.activeTab.modelRef, model: value };
		this.persist();
		new Notice(`Modell dieses Chats: ${this.shortModel(value)}`);
	}

	private refKey(ref: ModelRef): string {
		return `${ref.backend}|${ref.model}`;
	}

	/**
	 * Erkennt Serverfehler, die von Bildern kommen: "unsupported" (Modell nimmt
	 * keine Bilder, z. B. "At most 0 image(s)") oder "limit" (Obergrenze pro
	 * Anfrage, z. B. "At most 3 image(s)").
	 */
	private classifyImageRejection(
		err: unknown
	): { kind: "unsupported" } | { kind: "limit"; max: number } | null {
		if (!(err instanceof EuridianError) || err.kind !== "bad_request") return null;
		const msg = err.message;
		const atMost = /at most (\d+) image/i.exec(msg);
		if (atMost) {
			const max = parseInt(atMost[1], 10);
			return max > 0 ? { kind: "limit", max } : { kind: "unsupported" };
		}
		if (
			/(not support|unsupported|does not accept)[^.]{0,60}(image|vision|multimodal)/i.test(msg) ||
			/(image|vision|multimodal)[^.]{0,60}(not support|unsupported|not accepted)/i.test(msg)
		) {
			return { kind: "unsupported" };
		}
		return null;
	}

	/**
	 * Passt den Chat an, wenn der Server Bilder abgelehnt hat. Liefert true, wenn
	 * ein Wiederholungsversuch mit weniger/ohne Bilder sinnvoll ist. Greift nur,
	 * wenn wirklich Bilder im mitgeschickten Verlauf stecken und die Anpassung
	 * neu ist — sonst würde derselbe Fehler endlos wiederholt.
	 */
	private adaptToImageRejection(tab: ChatTab, err: unknown): boolean {
		const rejection = this.classifyImageRejection(err);
		if (!rejection) return false;
		const recent = tab.messages.slice(-this.plugin.settings.maxContextMessages);
		if (!recent.some((m) => m.role === "user" && m.images && m.images.length > 0)) {
			return false;
		}
		const key = this.refKey(tab.modelRef);
		const name = this.shortModel(tab.modelRef.model);
		if (rejection.kind === "unsupported") {
			if (tab.imagesRejectedFor.has(key)) return false;
			tab.imagesRejectedFor.add(key);
			new Notice(
				`„${name}“ nimmt keine Bilder an — sende ohne Bilder erneut. Für Bilder ein Modell mit Bildunterstützung wählen.`,
				8000
			);
			return true;
		}
		const known = tab.imageLimitFor.get(key);
		if (known !== undefined && known <= rejection.max) return false;
		tab.imageLimitFor.set(key, rejection.max);
		new Notice(
			`„${name}“ erlaubt max. ${rejection.max} Bilder pro Anfrage — sende mit den neuesten ${rejection.max} erneut.`,
			8000
		);
		return true;
	}

	private backendLabel(backend: Backend): string {
		return providerFor(backend).label;
	}

	/**
	 * Wird aufgerufen, wenn der Settings-Tab geschlossen wird (Modelllisten neu
	 * gescannt, Server/Key geändert, …). Die Chats behalten ihr Backend + Modell,
	 * aber Dropdown-Liste und Statuszeile werden aufgefrischt.
	 */
	refreshFromSettings(): void {
		if (this.tabs.length === 0) return;
		this.populateModelSelect();
		this.updateStatus();
	}

	/**
	 * Endpunkt nur zum Auflisten der Modelle (URL + Auth des Backends). Braucht
	 * kein gewähltes Modell — der Platzhalter wird von /models ignoriert.
	 */
	private listEndpoint(backend: Backend): ReturnType<typeof resolveEndpoint> {
		return resolveEndpoint(
			settingsForRef(this.plugin.settings, { backend, model: "?" })
		);
	}

	/** Endpunkt dieses Chats: Backend + Modell aus dem Tab, URL/Key aus den Settings. */
	private endpointFor(tab: ChatTab): ReturnType<typeof resolveEndpoint> {
		return resolveEndpoint(settingsForRef(this.plugin.settings, tab.modelRef));
	}

	/** Lädt die Modellliste eines Backends lazy und aktualisiert das Dropdown. */
	private async loadModels(backend: Backend): Promise<void> {
		try {
			const endpoint = this.listEndpoint(backend);
			const names = await this.client.listModels(endpoint);
			this.scannedModels.set(backend, names);
			// In die Settings spiegeln, damit der Settings-Tab dieselbe Liste zeigt.
			providerFor(backend).storeModels(this.plugin.settings, names.slice());
			await this.plugin.saveSettings();
			this.populateModelSelect();
		} catch {
			// Das Freitext-Modell bleibt nutzbar; kein harter Fehler nötig.
			this.scannedModels.set(backend, []);
		}
	}

	// ------------------------------------------------------------ Senden/Stream

	private onSendOrStop(): void {
		const tab = this.activeTab;
		if (tab.isStreaming) {
			tab.abortController?.abort();
			return;
		}
		const displayText = this.inputEl.value.trim();
		const attachments = this.pendingAttachments.splice(0); // leert das Array
		if (!displayText && attachments.length === 0) return;

		this.inputEl.value = "";
		this.renderAttachmentChips();
		this.updateStatus();

		// Textdateien und markierte Auswahlen als XML-Blöcke einbetten.
		const textAtts = attachments.filter(
			(a): a is Extract<PendingAttachment, { kind: "text" | "selection" }> =>
				a.kind === "text" || a.kind === "selection"
		);
		let apiContent = displayText;
		if (textAtts.length > 0) {
			const blocks = textAtts
				.map((a) =>
					a.kind === "selection"
						? `<selected_text source="${a.path}">\n${a.content}\n</selected_text>`
						: `<attached_file path="${a.path}">\n${a.content}\n</attached_file>`
				)
				.join("\n\n");
			apiContent = displayText ? `${displayText}\n\n${blocks}` : blocks;
		}

		// Bilder werden multimodal (image_url) gesendet.
		const images: AttachedImage[] = attachments
			.filter(
				(a): a is Extract<PendingAttachment, { kind: "image" }> =>
					a.kind === "image"
			)
			.map((a) => ({ name: a.name, dataUrl: a.dataUrl }));

		void this.sendMessage(
			tab,
			apiContent,
			displayText,
			textAtts.map((a) => a.name),
			images
		);
	}

	private async sendMessage(
		tab: ChatTab,
		apiContent: string,
		displayText: string,
		attachedFiles: string[] = [],
		images: AttachedImage[] = []
	): Promise<void> {
		if (
			images.length > 0 &&
			tab.imagesRejectedFor.has(this.refKey(tab.modelRef))
		) {
			new Notice(
				`„${this.shortModel(tab.modelRef.model)}“ hat Bilder zuvor abgelehnt — das Bild wird nicht mitgeschickt. Modell wechseln oder neuen Chat starten.`,
				8000
			);
		}

		if (tab.messages.length === 0) {
			tab.containerEl.empty();
			const titleSrc = displayText || attachedFiles[0] || "Chat";
			tab.title = titleSrc.length > 22 ? titleSrc.slice(0, 22) + "…" : titleSrc;
			this.renderTabBar();
		}

		tab.messages.push({
			role: "user",
			content: apiContent,
			displayContent: displayText || undefined,
			attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
			images: images.length > 0 ? images : undefined,
		});
		this.appendMessageBubble(
			tab,
			"user",
			displayText || "(Anhänge)",
			attachedFiles,
			images
		);
		this.persist();

		const { contentEl, bubbleEl } = this.appendMessageBubble(
			tab,
			"assistant",
			""
		);
		// Werkzeug-Aktivität wird über dem Text angezeigt.
		const toolsEl = bubbleEl.createDiv({ cls: "euridian-tools" });

		// „Denkt"-Indikator: animierte Punkte + Live-Timer (seit Senden).
		const thinkingEl = bubbleEl.createDiv({ cls: "euridian-thinking" });
		const thinkingDots = thinkingEl.createSpan({ cls: "euridian-thinking-dots" });
		thinkingDots.createSpan();
		thinkingDots.createSpan();
		thinkingDots.createSpan();
		const thinkingTimerEl = thinkingEl.createSpan({
			cls: "euridian-thinking-timer",
			text: "denkt 0 s",
		});
		const thinkingStart = Date.now();
		const thinkingTick = window.setInterval(() => {
			const secs = Math.floor((Date.now() - thinkingStart) / 1000);
			// Nach einer Weile ohne jedes Token vermuten wir eine serverseitige
			// Warteschlange (z. B. litellm/vLLM mit begrenzter Parallelität) und
			// sagen das dazu, statt einfach nur weiterzuzählen — sonst wirkt eine
			// lange, aber legitime Wartezeit wie ein Hänger (Nutzer-Feedback vom
			// 21.08.2026: Anfrage schien tot, kam aber bei Rückfrage sofort zurück).
			const text =
				secs >= QUEUE_HINT_THRESHOLD_S
					? `denkt ${secs} s (evtl. Warteschlange auf dem Server)`
					: `denkt ${secs} s`;
			thinkingTimerEl.setText(text);
		}, 1000);

		tab.abortController = new AbortController();
		tab.lastUsage = null;
		tab.lastResponseMs = null;
		tab.lastTokensPerSecond = null;
		this.syncInputState();

		let streamText = "";

		// Live-Markdown während des Streamens — gedrosselt (nicht bei jedem
		// Token, das wäre zu teuer) und serialisiert (Markdown-Render ist async).
		const RENDER_INTERVAL = 120;
		let lastRender = 0;
		let renderTimer: number | null = null;
		let rendering = false;
		let dirty = false;

		const renderNow = async () => {
			if (rendering) {
				dirty = true; // läuft schon → nach Abschluss erneut rendern
				return;
			}
			rendering = true;
			do {
				dirty = false;
				await this.renderMarkdown(contentEl, streamText);
			} while (dirty);
			rendering = false;
			if (tab.id === this.activeTabId) this.scrollToBottom();
		};

		const scheduleRender = () => {
			const elapsed = Date.now() - lastRender;
			if (elapsed >= RENDER_INTERVAL) {
				lastRender = Date.now();
				void renderNow();
			} else if (renderTimer === null) {
				renderTimer = window.setTimeout(() => {
					renderTimer = null;
					lastRender = Date.now();
					void renderNow();
				}, RENDER_INTERVAL - elapsed);
			}
		};

		const callbacks = {
			signal: tab.abortController.signal,
			onToken: (delta: string) => {
				if (thinkingEl.isConnected) thinkingEl.remove();
				streamText += delta;
				scheduleRender();
			},
			onUsage: (usage: TokenUsage) => {
				tab.lastUsage = usage;
			},
		};

		try {
			const endpoint = this.endpointFor(tab);
			const useAgent = this.plugin.settings.enableVaultAgent;
			const useWeb =
				this.plugin.settings.enableWebSearch &&
				!!this.plugin.settings.braveApiKey.trim();
			// Vault-Agent und Websuche sind unabhängige Schalter — beide, eines
			// oder keines kann aktiv sein. Tools nur senden, wenn mind. eines an ist.
			const tools: ToolDefinition[] | undefined =
				useAgent || useWeb
					? [
							...(useAgent ? getToolDefinitions() : []),
							...(useWeb ? getWebToolDefinitions() : []),
						]
					: undefined;

			// Lehnt der Server die Bilder im Verlauf ab (Modellwechsel!), passen wir
			// die Bildmenge an und versuchen es EINMAL neu. Nur, solange noch kein
			// Werkzeug lief — sonst könnten Schreibaktionen doppelt passieren.
			let attempt = 0;
			for (;;) {
				// Arbeits-Nachrichten für diese Nutzer-Runde (inkl. Tool-Zwischenschritte).
				const working: ApiMessage[] = await this.buildRequestMessages(tab);
				try {
					await this.runAgentLoop(
						tab,
						endpoint,
						working,
						tools,
						callbacks,
						toolsEl,
						thinkingEl
					);
					break;
				} catch (loopErr) {
					if (
						attempt++ > 0 ||
						toolsEl.childElementCount > 0 ||
						!this.adaptToImageRejection(tab, loopErr)
					) {
						throw loopErr;
					}
				}
			}

			// t/s aus completionTokens des finalen Turns ÷ dessen Dauer.
			// Cast nötig: TS narrowt tab.lastUsage fälschlich auf den Stand VOR
			// dem await (frühere "= null"-Zuweisung), weil es nicht erkennt, dass
			// die onUsage-Callback-Closure den Wert während runAgentLoop() neu setzt.
			const currentUsage = tab.lastUsage as TokenUsage | null;
			tab.lastTokensPerSecond = null;
			if (currentUsage !== null && tab.lastResponseMs !== null && tab.lastResponseMs > 0) {
				tab.lastTokensPerSecond =
					currentUsage.completionTokens / (tab.lastResponseMs / 1000);
			}

			if (thinkingEl.isConnected) thinkingEl.remove();

			if (streamText.trim()) {
				tab.messages.push({ role: "assistant", content: streamText });
				await this.renderMarkdown(contentEl, streamText);
				this.addAssistantActions(bubbleEl, streamText);
			} else if (toolsEl.childElementCount > 0) {
				contentEl.setText("(Aktionen ausgeführt — siehe oben)");
			} else {
				contentEl.setText("(keine Antwort)");
			}
		} catch (err) {
			if (thinkingEl.isConnected) thinkingEl.remove();
			this.handleStreamError(err, tab, contentEl, streamText, bubbleEl);
		} finally {
			// Geplanten Live-Render abbrechen — der finale Render oben ist maßgeblich.
			if (renderTimer !== null) window.clearTimeout(renderTimer);
			window.clearInterval(thinkingTick);
			tab.abortController = null;
			this.syncInputState();
			this.updateStatus();
			if (tab.id === this.activeTabId) this.scrollToBottom();
			this.persist();
		}
	}

	/**
	 * Agent-Schleife: streamt einen Turn; fordert das Modell Werkzeuge an,
	 * führt sie aus, reicht die Ergebnisse zurück und streamt weiter — bis das
	 * Modell ohne Tool-Call antwortet oder das Iterationslimit erreicht ist.
	 */
	private async runAgentLoop(
		tab: ChatTab,
		endpoint: ReturnType<typeof resolveEndpoint>,
		working: ApiMessage[],
		tools: ReturnType<typeof getToolDefinitions> | undefined,
		callbacks: Parameters<EuridianApiClient["streamChat"]>[4],
		toolsEl: HTMLElement,
		thinkingEl: HTMLElement
	): Promise<void> {
		// Läuft über alle Iterationen dieser einen Nutzer-Anfrage mit.
		let cumulativeToolOutputChars = 0;
		// Alles ab hier gehört zu DIESEM Aufruf (Verlauf/System davor bleibt bei
		// der Kompression unangetastet, siehe compactWorkingIfNeeded).
		const loopStartIdx = working.length;

		for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
			if (i > 0) {
				await this.compactWorkingIfNeeded(endpoint, working, loopStartIdx);
			}
			const turnStart = Date.now();
			const result = await this.client.streamChat(
				endpoint,
				working,
				effectiveThinking(settingsForRef(this.plugin.settings, tab.modelRef)),
				this.plugin.settings.temperature,
				callbacks,
				tools
			);

			// Keine Werkzeuge angefordert → fertige Antwort. Dauer NUR dieses
			// finalen Turns merken (schließt Tool-Ausführung/Bestätigungen aus
			// vorherigen Runden aus — sonst würde t/s durch Wartezeiten verzerrt).
			if (result.toolCalls.length === 0) {
				tab.lastResponseMs = Date.now() - turnStart;
				return;
			}

			// Infomaniak verlangt tool_call_id = exakt 9 alphanumerische Zeichen.
			// Abweichende IDs konsistent normalisieren (gilt für assistant + tool).
			for (const call of result.toolCalls) {
				if (!/^[a-zA-Z0-9]{9}$/.test(call.id)) call.id = this.randomToolId();
			}

			// Assistant-Turn mit Tool-Calls in den Verlauf aufnehmen.
			working.push({
				role: "assistant",
				content: result.content || null,
				tool_calls: result.toolCalls,
			});

			// Jeden Tool-Call anzeigen, ausführen und Ergebnis zurückgeben.
			for (const call of result.toolCalls) {
				if (thinkingEl.isConnected) thinkingEl.remove();
				const chipEl = this.renderToolChip(toolsEl, describeToolCall(call));

				let output: string;

				if (cumulativeToolOutputChars >= MAX_TOOL_OUTPUT_CHARS_PER_TURN) {
					// Budget für diese Anfrage aufgebraucht — nicht mehr ausführen,
					// sonst droht ein Kontext-Limit-Fehler des Backends.
					chipEl.addClass("is-rejected");
					output =
						"Fehler: Zu viele/große Werkzeug-Ergebnisse in dieser Anfrage " +
						"(Kontext-Budget erschöpft). Nutze list_notes' Dateigröße gezielter, " +
						"statt viele Notizen einzeln mit read_note zu öffnen, oder fasse " +
						"zusammen, was du bisher gefunden hast.";
				} else if (isWebTool(call.function.name)) {
					// Websuche ist rein lesend — keine Schreib-Bestätigung nötig.
					output = await executeWebToolCall(
						this.plugin.settings.braveApiKey.trim(),
						call
					);
					chipEl.addClass("is-done");
				} else {
					const needsConfirm =
						this.plugin.settings.confirmBeforeWrite &&
						isWriteTool(call.function.name);

					if (needsConfirm) {
						const action = this.parseWriteAction(call);
						const approved = action
							? await confirmWrite(this.app, action)
							: true;
						if (!approved) {
							chipEl.addClass("is-rejected");
							output =
								"Der Nutzer hat diese Schreibaktion abgelehnt. Führe sie nicht aus. " +
								"Frage bei Bedarf nach, was stattdessen geschehen soll.";
						} else {
							output = await executeToolCall(this.app, call);
							chipEl.addClass("is-done");
						}
					} else {
						output = await executeToolCall(this.app, call);
						chipEl.addClass("is-done");
					}
				}

				cumulativeToolOutputChars += output.length;

				working.push({
					role: "tool",
					tool_call_id: call.id,
					content: output,
				});
			}
			// Vor dem nächsten Turn wieder „denkt …" zeigen.
			if (i < MAX_AGENT_ITERATIONS - 1) {
				toolsEl.insertAdjacentElement("afterend", thinkingEl);
			}
		}

		new Notice(`${VARIANT.name}: Maximale Werkzeug-Schritte erreicht.`);
	}

	// ------------------------------------------------------- Datei-Anhänge

	private openFilePicker(): void {
		new FileSuggestModal(this.app, async (file) => {
			await this.addVaultAttachment(file);
		}).open();
	}

	/** Holt die aktuelle Editor-Selektion und hängt sie als Kontext an. */
	private attachCurrentSelection(): void {
		const view = this.getContextMarkdownView();
		const sel = view?.editor.getSelection() ?? "";
		if (!sel.trim()) {
			new Notice("Kein Text markiert.");
			return;
		}
		this.addSelectionAttachment(sel, view?.file?.path ?? "Notiz");
	}

	/**
	 * Hängt markierten Text als Kontext-Snippet an die nächste Nachricht.
	 * Öffentlich, damit Command und Editor-Kontextmenü (main.ts) es nutzen können.
	 */
	addSelectionAttachment(text: string, path: string): void {
		let content = text;
		let truncated = false;
		if (content.length > MAX_ATTACHMENT_CHARS) {
			content = content.slice(0, MAX_ATTACHMENT_CHARS);
			truncated = true;
		}
		const noteName = path.split("/").pop() ?? path;
		const name = `Auswahl: ${noteName} (${text.length} Z.)`;
		this.pendingAttachments.push({ kind: "selection", name, path, content });
		this.renderAttachmentChips();
		this.updateStatus();
		new Notice(
			truncated
				? `Auswahl angehängt (auf ${MAX_ATTACHMENT_CHARS.toLocaleString()} Zeichen gekürzt).`
				: "Auswahl zum Kontext hinzugefügt."
		);
	}

	/** Vault-Notiz (Markdown) als Text-Anhang. */
	private async addVaultAttachment(file: TFile): Promise<void> {
		if (this.pendingAttachments.some((a) => a.path === file.path)) {
			new Notice(`${file.name} ist bereits angehängt.`);
			return;
		}
		let content = await this.app.vault.cachedRead(file);
		if (content.length > MAX_ATTACHMENT_CHARS) {
			content = content.slice(0, MAX_ATTACHMENT_CHARS);
			new Notice(
				`${file.name}: auf ${MAX_ATTACHMENT_CHARS.toLocaleString()} Zeichen gekürzt.`
			);
		}
		this.pendingAttachments.push({
			kind: "text",
			name: file.name,
			path: file.path,
			content,
		});
		this.renderAttachmentChips();
		this.updateStatus();
	}

	/** Verarbeitet alle per Drag & Drop fallengelassenen Dateien. */
	private async handleExternalDrop(evt: DragEvent): Promise<void> {
		const files = evt.dataTransfer?.files;
		if (!files || files.length === 0) return;
		for (let i = 0; i < files.length; i++) {
			await this.addExternalFile(files[i]);
		}
	}

	/** Externe Datei (aus dem Finder) klassifizieren und als Anhang aufnehmen. */
	private async addExternalFile(file: File): Promise<void> {
		// Bei externen Dateien gibt Electron einen .path; sonst nur den Namen.
		const path = (file as File & { path?: string }).path || file.name;
		if (this.pendingAttachments.some((a) => a.path === path)) {
			new Notice(`${file.name} ist bereits angehängt.`);
			return;
		}

		const kind = classifyFile(file.name, file.type);
		if (kind === null) {
			new Notice(
				`${file.name}: Dateityp nicht unterstützt (nur Text- und Bilddateien).`
			);
			return;
		}

		if (kind === "image") {
			if (file.size > MAX_IMAGE_BYTES) {
				new Notice(
					`${file.name} ist zu groß (max. ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`
				);
				return;
			}
			let dataUrl: string;
			try {
				dataUrl = await this.readAsDataUrl(file);
			} catch {
				new Notice(`${file.name} konnte nicht gelesen werden.`);
				return;
			}
			this.pendingAttachments.push({
				kind: "image",
				name: file.name,
				path,
				dataUrl,
			});
		} else {
			let content: string;
			try {
				content = await file.text();
			} catch {
				new Notice(`${file.name} konnte nicht gelesen werden.`);
				return;
			}
			if (content.length > MAX_ATTACHMENT_CHARS) {
				content = content.slice(0, MAX_ATTACHMENT_CHARS);
				new Notice(
					`${file.name}: auf ${MAX_ATTACHMENT_CHARS.toLocaleString()} Zeichen gekürzt.`
				);
			}
			this.pendingAttachments.push({
				kind: "text",
				name: file.name,
				path,
				content,
			});
		}

		new Notice(`${file.name} zum Kontext hinzugefügt.`);
		this.renderAttachmentChips();
		this.updateStatus();
	}

	/** Liest eine Datei als Base64-Data-URL. */
	private readAsDataUrl(file: File): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	private renderAttachmentChips(): void {
		this.attachmentsEl.empty();
		this.attachmentsEl.toggleClass(
			"is-hidden",
			this.pendingAttachments.length === 0
		);
		for (const att of this.pendingAttachments) {
			const chip = this.attachmentsEl.createDiv({
				cls: "euridian-attachment-chip",
			});
			const icon =
				att.kind === "image"
					? "image"
					: att.kind === "selection"
						? "highlighter"
						: "paperclip";
			setIcon(chip.createSpan({ cls: "euridian-tool-icon" }), icon);
			chip.createSpan({
				cls: "euridian-tool-label",
				text: att.name,
				attr: { title: att.path },
			});
			const removeEl = chip.createSpan({ cls: "euridian-attachment-remove" });
			setIcon(removeEl, "x");
			removeEl.addEventListener("click", () => {
				// Identitätsbasiert entfernen — mehrere Auswahlen können denselben
				// Pfad teilen, dürfen aber einzeln entfernbar sein.
				this.pendingAttachments = this.pendingAttachments.filter(
					(a) => a !== att
				);
				this.renderAttachmentChips();
				this.updateStatus();
			});
		}
	}

	/** Liest path/content eines Schreib-Tool-Calls für die Bestätigungs-Vorschau. */
	private parseWriteAction(call: {
		function: { name: string; arguments: string };
	}): WriteAction | null {
		try {
			const a = JSON.parse(call.function.arguments || "{}");
			return {
				tool: call.function.name,
				path: a.path ?? "",
				content: a.content ?? "",
			};
		} catch {
			return null;
		}
	}

	/** Erzeugt eine gültige 9-stellige alphanumerische Tool-Call-ID. */
	private randomToolId(): string {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		let id = "";
		for (let i = 0; i < 9; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		return id;
	}

	/**
	 * Rendert einen Werkzeug-Aktivitäts-Chip und gibt ihn zurück. Baut beim
	 * ersten Chip lazy einen einklappbaren Header (Klick = auf-/zuklappen).
	 * Standardmäßig eingeklappt: nur der jeweils neueste Chip ist sichtbar,
	 * damit lange Werkzeug-Ketten nicht das Chat-Fenster fluten.
	 */
	private renderToolChip(toolsEl: HTMLElement, label: string): HTMLElement {
		let listEl = toolsEl.querySelector<HTMLElement>(":scope > .euridian-tools-list");
		let headerEl = toolsEl.querySelector<HTMLElement>(":scope > .euridian-tools-header");

		if (!listEl || !headerEl) {
			headerEl = toolsEl.createDiv({ cls: "euridian-tools-header" });
			const chevron = headerEl.createSpan({ cls: "euridian-tools-chevron" });
			setIcon(chevron, "chevron-right");
			headerEl.createSpan({ cls: "euridian-tools-count" });
			listEl = toolsEl.createDiv({ cls: "euridian-tools-list is-collapsed" });

			const list = listEl;
			headerEl.addEventListener("click", () => {
				const collapsed = list.classList.toggle("is-collapsed");
				headerEl!.classList.toggle("is-expanded", !collapsed);
			});
		}

		const chip = listEl.createDiv({ cls: "euridian-tool-chip" });
		setIcon(chip.createSpan({ cls: "euridian-tool-icon" }), "wrench");
		chip.createSpan({ cls: "euridian-tool-label", text: label });

		const count = listEl.childElementCount;
		headerEl.querySelector(".euridian-tools-count")?.setText(
			`${count} Werkzeug-Aufruf${count === 1 ? "" : "e"}`
		);

		if (this.activeTab.id === this.activeTabId) this.scrollToBottom();
		return chip;
	}

	private async buildRequestMessages(tab: ChatTab): Promise<ApiMessage[]> {
		const s = this.plugin.settings;
		const result: ApiMessage[] = [];

		// Reihenfolge bewusst: Hintergrund-Dokumente ZUERST, das Agent-Mandat
		// ZULETZT. Modelle gewichten das Ende stärker (Recency) — so überschreibt
		// ein langer CLAUDE.md-Block nicht die Werkzeug-Anweisung.
		const systemParts: string[] = [];

		if (s.euridianInstructionsPath) {
			const instructions = await this.loadInstructionsFile(s.euridianInstructionsPath);
			if (instructions) systemParts.push(instructions);
		}

		if (s.includeCurrentNote) {
			const noteContext = this.getCurrentNoteContext();
			if (noteContext) systemParts.push(noteContext);
		}

		if (s.autoCompactHistory && tab.messages.length > s.maxContextMessages) {
			await this.ensureHistorySummary(tab, s.maxContextMessages);
		}
		if (tab.historySummary) {
			systemParts.push(
				`<conversation_summary>\nZusammenfassung des bisherigen, nicht mehr im ` +
					`Volltext enthaltenen Gesprächsverlaufs:\n${tab.historySummary}\n</conversation_summary>`
			);
		}

		if (s.systemPrompt.trim()) systemParts.push(s.systemPrompt.trim());

		// Agent-Mandat ans Ende. Vault-Agent und Websuche sind unabhängig schaltbar.
		const useWebForPrompt = s.enableWebSearch && !!s.braveApiKey.trim();
		if (s.enableVaultAgent || useWebForPrompt) {
			systemParts.push(buildAgentSystemPrompt(s.enableVaultAgent, useWebForPrompt));
		}

		if (systemParts.length > 0) {
			result.push({ role: "system", content: systemParts.join("\n\n") });
		}

		// Bilder im Verlauf hängen am Modell: ein Wechsel auf ein Modell ohne
		// Bildunterstützung (oder mit Bild-Obergrenze) ließ sonst JEDE weitere
		// Nachricht mit HTTP 400 scheitern, solange ein Bild in den letzten
		// Nachrichten steckt. Hat der Server Bilder abgelehnt (imagesRejectedFor /
		// imageLimitFor, siehe adaptToImageRejection), schicken wir nur noch so
		// viele Bilder mit, wie das Modell nimmt — die neuesten zuerst.
		const recent = tab.messages.slice(-s.maxContextMessages);
		const key = this.refKey(tab.modelRef);
		let allowance = tab.imagesRejectedFor.has(key)
			? 0
			: (tab.imageLimitFor.get(key) ?? Infinity);
		const keepCount = new Map<number, number>();
		for (let i = recent.length - 1; i >= 0 && allowance > 0; i--) {
			const imgs = recent[i].role === "user" ? recent[i].images : undefined;
			if (imgs && imgs.length > 0) {
				const keep = Math.min(imgs.length, allowance);
				keepCount.set(i, keep);
				allowance -= keep;
			}
		}

		recent.forEach((m, i) => {
			if (m.role === "user" && m.images && m.images.length > 0) {
				const keep = keepCount.get(i) ?? 0;
				const dropped = m.images.length - keep;
				const note =
					dropped > 0
						? `\n[${dropped} Bild${dropped > 1 ? "er" : ""} für dieses Modell nicht mitgeschickt.]`
						: "";
				if (keep === 0) {
					result.push({ role: m.role, content: (m.content || "") + note });
					return;
				}
				// Multimodal: Text + ein image_url-Teil pro (behaltenem) Bild.
				const parts: ContentPart[] = [];
				if (m.content || note) {
					parts.push({ type: "text", text: (m.content || "") + note });
				}
				for (const img of m.images.slice(-keep)) {
					parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
				}
				result.push({ role: m.role, content: parts });
			} else {
				result.push({ role: m.role, content: m.content });
			}
		});
		return result;
	}

	/** Nicht-streamender Hilfsaufruf für interne Zwecke (Zusammenfassungen). */
	private async requestPlainCompletion(
		endpoint: ResolvedEndpoint,
		systemPrompt: string,
		userPrompt: string
	): Promise<string> {
		let text = "";
		await this.client.streamChat(
			endpoint,
			[
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			false,
			0.3,
			{
				onToken: (delta) => {
					text += delta;
				},
			}
		);
		return text.trim();
	}

	/**
	 * Fasst Nachrichten zusammen, die wegen `maxContextMessages` aus dem
	 * gesendeten Verlauf fallen — analog zu Claude Codes Auto-Compact. Läuft
	 * inkrementell: nur neu herausfallende Nachrichten werden zusätzlich zur
	 * vorherigen Zusammenfassung verarbeitet, nicht der gesamte Verlauf erneut.
	 */
	private async ensureHistorySummary(tab: ChatTab, recentWindow: number): Promise<void> {
		const cutoff = tab.messages.length - recentWindow;
		if (cutoff <= tab.summarizedThroughIndex) return;

		const newlyDropped = tab.messages.slice(tab.summarizedThroughIndex, cutoff);
		const transcript = newlyDropped
			.map((m) => `${m.role === "user" ? "Nutzer" : "Assistent"}: ${m.content}`)
			.join("\n\n");
		const priorSummary = tab.historySummary
			? `Bisherige Zusammenfassung:\n${tab.historySummary}\n\n`
			: "";

		try {
			const endpoint = this.endpointFor(tab);
			const summary = await this.requestPlainCompletion(
				endpoint,
				"Du fasst Chat-Verläufe präzise und kompakt zusammen. Erhalte wichtige " +
					"Fakten, Entscheidungen, Zwischenergebnisse und offene Fragen. Nur " +
					"Fließtext, keine Höflichkeitsfloskeln, max. ~250 Wörter.",
				`${priorSummary}Neue Nachrichten seit der letzten Zusammenfassung:\n${transcript}\n\n` +
					"Fasse den GESAMTEN bisherigen Verlauf (alte Zusammenfassung + neue " +
					"Nachrichten) neu zusammen."
			);
			tab.historySummary = summary;
			tab.summarizedThroughIndex = cutoff;
		} catch {
			// Zusammenfassung fehlgeschlagen (z. B. Server nicht erreichbar) — beim
			// nächsten Request erneut versuchen, bis dahin bleibt die alte (ggf.
			// unvollständige) Zusammenfassung bzw. gar keine.
		}
	}

	private estimateApiMessagesChars(messages: ApiMessage[]): number {
		return messages.reduce(
			(sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
			0
		);
	}

	/**
	 * Komprimiert ältere Werkzeug-Runden EINER laufenden Anfrage, sobald sie zu
	 * groß werden. `loopStartIdx` markiert den Anfang der in diesem Aufruf von
	 * runAgentLoop hinzugefügten Nachrichten — alles davor (Verlauf/System)
	 * bleibt unangetastet. Die jeweils letzte Runde bleibt immer vollständig
	 * erhalten (aktuellster Kontext fürs Modell).
	 */
	private async compactWorkingIfNeeded(
		endpoint: ResolvedEndpoint,
		working: ApiMessage[],
		loopStartIdx: number
	): Promise<void> {
		const loopSlice = working.slice(loopStartIdx);
		if (this.estimateApiMessagesChars(loopSlice) < WORKING_COMPACT_THRESHOLD_CHARS) return;

		const roundStarts: number[] = [];
		for (let i = loopStartIdx; i < working.length; i++) {
			if (working[i].role === "assistant") roundStarts.push(i);
		}
		if (roundStarts.length < 2) return; // Letzte Runde nie antasten.

		const keepFromIdx = roundStarts[roundStarts.length - 1];
		const toCompact = working.slice(loopStartIdx, keepFromIdx);
		if (toCompact.length === 0) return;

		const transcript = toCompact
			.map((m) => {
				if (m.role === "assistant" && m.tool_calls) {
					return m.tool_calls
						.map((c) => `→ Werkzeug ${c.function.name}(${c.function.arguments})`)
						.join("\n");
				}
				if (m.role === "tool") {
					const text = typeof m.content === "string" ? m.content : "";
					return `Ergebnis: ${text.slice(0, 2000)}`;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");

		try {
			const summary = await this.requestPlainCompletion(
				endpoint,
				"Du fasst die bisherigen Werkzeug-Aufrufe eines KI-Agenten kompakt " +
					"zusammen: was wurde geprüft/gefunden, was ist das Zwischenergebnis. " +
					"Nur Fließtext, keine Floskeln, max. ~200 Wörter.",
				transcript.slice(0, 60_000)
			);
			working.splice(loopStartIdx, toCompact.length, {
				role: "assistant",
				content: `[Zusammenfassung bisheriger Werkzeug-Schritte in dieser Anfrage]\n${summary}`,
			});
		} catch {
			// Kompression fehlgeschlagen — weiter mit vollem Verlauf, das
			// Zeichen-Budget (MAX_TOOL_OUTPUT_CHARS_PER_TURN) greift notfalls
			// als harte Grenze.
		}
	}

	/** Lädt eine einzelne Instruktionsdatei aus dem Vault (Pfad relativ zum Root). */
	private async loadInstructionsFile(path: string): Promise<string | null> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return null;
		let content = await this.app.vault.cachedRead(f);
		if (!content.trim()) return null;
		if (content.length > MAX_INSTRUCTIONS_CHARS) {
			content =
				content.slice(0, MAX_INSTRUCTIONS_CHARS) +
				`\n\n[… gekürzt, ${content.length - MAX_INSTRUCTIONS_CHARS} Zeichen ausgelassen]`;
		}
		return `<euridian_instructions path="${path}">\n${content}\n</euridian_instructions>`;
	}

	private getCurrentNoteContext(): string | null {
		const view = this.getContextMarkdownView();
		const file = view?.file;
		if (!file) return null;
		let content = view?.editor.getValue();
		if (!content) return null;
		// Gleiche Deckelung wie read_note (vault-tools.ts) — ohne Limit würde eine
		// große offene Notiz bei JEDER Nachricht unbegrenzt Kontext verbrauchen und
		// kann serverseitige Kontext-Limits sprengen (z. B. 65536 Token bei manchen
		// Deployments, deutlich unter dem dokumentierten Modell-Maximum).
		if (content.length > MAX_CURRENT_NOTE_CHARS) {
			content =
				content.slice(0, MAX_CURRENT_NOTE_CHARS) +
				`\n\n[… gekürzt, ${content.length - MAX_CURRENT_NOTE_CHARS} Zeichen ausgelassen]`;
		}
		return `<current_note path="${file.path}">\n${content}\n</current_note>`;
	}

	private handleStreamError(
		err: unknown,
		tab: ChatTab,
		contentEl: HTMLElement,
		partialText: string,
		bubbleEl: HTMLElement
	): void {
		if (err instanceof EuridianError && err.kind === "aborted") {
			if (partialText.trim()) {
				tab.messages.push({ role: "assistant", content: partialText });
				void this.renderMarkdown(contentEl, partialText);
				contentEl.createDiv({
					cls: "euridian-aborted-note",
					text: "— abgebrochen —",
				});
			} else {
				bubbleEl.remove();
			}
			return;
		}

		const msg =
			err instanceof EuridianError
				? err.message
				: `Unerwarteter Fehler: ${String(err)}`;
		contentEl.empty();
		contentEl.createDiv({ cls: "euridian-error", text: `⚠ ${msg}` });
		new Notice(`${VARIANT.name}: ${msg}`, 8000);
	}

	// ----------------------------------------------------------- Nachrichten-UI

	private appendMessageBubble(
		tab: ChatTab,
		role: "user" | "assistant",
		text: string,
		attachedFiles?: string[],
		images?: AttachedImage[]
	): { bubbleEl: HTMLElement; contentEl: HTMLElement } {
		const bubbleEl = tab.containerEl.createDiv({
			cls: `euridian-msg euridian-msg-${role}`,
		});
		const contentEl = bubbleEl.createDiv({ cls: "euridian-msg-content" });
		if (text) contentEl.setText(text);

		// Bild-Vorschauen unter der Nachricht.
		if (role === "user" && images && images.length > 0) {
			const imgWrap = bubbleEl.createDiv({ cls: "euridian-msg-images" });
			for (const img of images) {
				imgWrap.createEl("img", {
					cls: "euridian-msg-thumb",
					attr: { src: img.dataUrl, title: img.name, alt: img.name },
				});
			}
		}

		// Datei-Chips unter User-Nachrichten (nicht-interaktiv, da bereits gesendet).
		if (role === "user" && attachedFiles && attachedFiles.length > 0) {
			const filesEl = bubbleEl.createDiv({ cls: "euridian-msg-files" });
			for (const name of attachedFiles) {
				const chip = filesEl.createSpan({ cls: "euridian-file-chip" });
				setIcon(chip.createSpan({ cls: "euridian-tool-icon" }), "file-text");
				chip.createSpan({
					text: name.split("/").pop() ?? name,
					attr: { title: name },
				});
			}
		}

		if (tab.id === this.activeTabId) this.scrollToBottom();
		return { bubbleEl, contentEl };
	}

	private addAssistantActions(bubbleEl: HTMLElement, text: string): void {
		const actions = bubbleEl.createDiv({ cls: "euridian-msg-actions" });

		const copyBtn = actions.createEl("button", {
			cls: "euridian-icon-btn",
			attr: { "aria-label": "Kopieren" },
		});
		setIcon(copyBtn, "copy");
		copyBtn.onclick = async () => {
			await navigator.clipboard.writeText(text);
			new Notice("Kopiert.");
		};

		const insertBtn = actions.createEl("button", {
			cls: "euridian-icon-btn",
			attr: { "aria-label": "In Notiz einfügen" },
		});
		setIcon(insertBtn, "file-down");
		insertBtn.onclick = () => this.insertIntoNote(text);
	}

	private async insertIntoNote(text: string): Promise<void> {
		const view = this.getContextMarkdownView();
		if (!view) {
			new Notice("Keine aktive Notiz zum Einfügen geöffnet.");
			return;
		}
		const noteName = view.file?.basename ?? "Notiz";

		// Nicht-leere Auswahl im Zieleditor → könnte aus einer Notiz stammen,
		// die der Nutzer längst nicht mehr sieht (der Chat merkt sich die
		// zuletzt aktive Notiz auch nach Fokuswechsel, siehe
		// getContextMarkdownView). Erst bestätigen lassen, statt sie
		// kommentarlos zu überschreiben.
		const selection = view.editor.getSelection();
		if (selection) {
			const ok = await confirmInsert(this.app, noteName, selection);
			if (!ok) return;
		}

		view.editor.replaceSelection(text);
		new Notice(`In "${noteName}" eingefügt.`);
	}

	private async renderMarkdown(el: HTMLElement, markdown: string): Promise<void> {
		el.empty();
		await MarkdownRenderer.render(
			this.app,
			markdown,
			el,
			this.getContextMarkdownView()?.file?.path ?? "",
			this
		);
	}

	// -------------------------------------------------------------- Hilfsmethoden

	private renderEmptyState(tab: ChatTab): void {
		tab.containerEl.empty();
		const empty = tab.containerEl.createDiv({ cls: "euridian-empty" });
		empty.createDiv({ cls: "euridian-empty-title", text: `${VARIANT.name} Chat` });
		empty.createDiv({
			cls: "euridian-empty-sub",
			text: this.plugin.settings.includeCurrentNote
				? "Die aktuelle Notiz wird als Kontext mitgesendet."
				: "Stell eine Frage, um zu starten.",
		});
	}

	/** Send-Button + Eingabe an den Streaming-Zustand des aktiven Tabs anpassen. */
	private syncInputState(): void {
		const streaming = this.activeTab.isStreaming;
		this.sendBtn.setText(streaming ? "Stop" : "Senden");
		this.sendBtn.toggleClass("mod-warning", streaming);
		this.sendBtn.toggleClass("mod-cta", !streaming);
	}

	private updateStatus(): void {
		const tab = this.activeTab;
		const inputTokens = estimateTokens(this.inputEl.value);
		const imageAttCount = this.pendingAttachments.filter(
			(a) => a.kind === "image"
		).length;
		const attachmentTokens = this.pendingAttachments.reduce(
			(sum, a) => (a.kind === "image" ? sum : sum + estimateTokens(a.content)),
			0
		);
		const historyTokens = tab.messages.reduce(
			(sum, m) => sum + estimateTokens(m.content),
			0
		);
		// Größe der Instruktionsdatei einbeziehen (Byte-Größe reicht, kein
		// vollständiges Lesen nötig) — macht ihren sonst unsichtbaren
		// Kontext-/Kostenbeitrag im Zähler sichtbar (Security-Audit, 19.08.2026).
		let instructionsTokens = 0;
		if (this.plugin.settings.euridianInstructionsPath) {
			const f = this.app.vault.getAbstractFileByPath(
				this.plugin.settings.euridianInstructionsPath
			);
			if (f instanceof TFile) {
				instructionsTokens = Math.ceil(
					Math.min(f.stat.size, MAX_INSTRUCTIONS_CHARS) / 4
				);
			}
		}
		let status = `~${historyTokens + inputTokens + attachmentTokens + instructionsTokens} Token im Kontext`;
		// Zeigt, WELCHE Notiz als Kontext mitgesendet würde — sonst nicht
		// erkennbar, dass das die zuletzt aktive Notiz sein kann, auch wenn
		// der Nutzer längst zu einer anderen gewechselt hat (Security-Audit,
		// 19.08.2026).
		if (this.plugin.settings.includeCurrentNote) {
			const noteName = this.getContextMarkdownView()?.file?.basename;
			if (noteName) status += ` · Notiz: ${noteName}`;
		}
		if (imageAttCount > 0) {
			status += ` · ${imageAttCount} Bild${imageAttCount > 1 ? "er" : ""}`;
		}
		if (tab.lastUsage) {
			status += ` · letzte Antwort: ${tab.lastUsage.totalTokens} Token`;
			if (tab.lastTokensPerSecond) {
				status += ` · ~${tab.lastTokensPerSecond.toFixed(1)} t/s`;
			}
		}
		this.statusEl.setText(status);
	}

	private scrollToBottom(): void {
		const el = this.activeTab?.containerEl;
		if (el) el.scrollTop = el.scrollHeight;
	}
}
