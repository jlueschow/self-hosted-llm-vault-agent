/**
 * Euridian — Vault-Werkzeuge für den Agenten (Function Calling).
 *
 * Definiert die Tools, die dem Modell angeboten werden, und führt sie gegen
 * Obsidians `vault`-API aus. Pfade sind immer relativ zum Vault-Root.
 *
 * SICHERHEIT: Es gibt bewusst KEIN Lösch-Werkzeug (globale Datei-Sicherheits-
 * regel). Schreibende Aktionen melden sich über `Notice`, damit der Nutzer
 * sie mitbekommt, auch wenn der Agent ohne Rückfrage arbeitet.
 */

import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { ToolCall, ToolDefinition } from "./types";
// Direkt pdfjs-dist statt pdf-parse: pdf-parse v2 zieht @napi-rs/canvas (native
// Node-Addon) hinein und referenziert beim reinen Modul-Import bereits
// DOMMatrix/Canvas-Setup, was das Plugin in Obsidian mit "ReferenceError:
// DOMMatrix is not defined" beim Laden abstürzen ließ. pdfjs-dist selbst
// braucht Canvas nur für Rendering (_createCanvas, lazy) — reine Text-
// Extraktion über getTextContent() kommt ganz ohne Canvas aus.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_WORKER_SOURCE } from "./pdf-worker-source";
import * as mammoth from "mammoth";
import JSZip from "jszip";

/** Max. Zeichen, die ein read_note an das Modell zurückgibt (Token-Schutz). */
const MAX_READ_CHARS = 40_000;
/** Max. Treffer bei der Suche. */
const MAX_SEARCH_HITS = 25;
/** Max. Pfade bei list_notes. */
const MAX_LIST = 300;
/** Unterstützte Nicht-Markdown-Dokumenttypen für read_document/list_documents. */
const DOCUMENT_EXTENSIONS = ["pdf", "docx", "pptx"] as const;

/** Stellt sicher, dass ein Notizpfad auf .md endet und normalisiert ist. */
export function asNotePath(path: string): string {
	let p = normalizePath(path.trim());
	if (!p.toLowerCase().endsWith(".md")) p += ".md";
	return p;
}

/** Legt fehlende Elternordner für einen Pfad an. */
async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return;
	const folder = path.slice(0, slash);
	if (!app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder).catch(() => {
			/* existiert evtl. schon — egal */
		});
	}
}

/** Die Werkzeug-Definitionen, die dem Modell mitgeschickt werden. */
export function getToolDefinitions(): ToolDefinition[] {
	return [
		{
			type: "function",
			function: {
				name: "list_notes",
				description:
					"Listet Markdown-Notizen im Vault auf (Pfad + Dateigröße in Byte), optional " +
					"gefiltert auf einen Ordner (Präfix). NUTZE DIE DATEIGRÖSSE, um leere/fast-leere " +
					"Notizen zu erkennen (⚠-Markierung bei ≤50 Byte) — rufe dafür NICHT read_note " +
					"für jede einzelne Datei auf, das ist unnötig teuer und sprengt bei vielen " +
					"Dateien den Kontext. read_note nur für Notizen nutzen, deren Inhalt du wirklich brauchst.",
				parameters: {
					type: "object",
					properties: {
						folder: {
							type: "string",
							description:
								"Optionaler Ordner-Präfix, z. B. '03 Projekte'. Leer = ganzer Vault.",
						},
					},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "read_note",
				description:
					"Liest den vollständigen Inhalt einer Markdown-Notiz aus dem Vault.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Pfad zur Notiz relativ zum Vault-Root.",
						},
					},
					required: ["path"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "list_documents",
				description:
					"Listet Nicht-Markdown-Dokumente im Vault auf (PDF, DOCX, PPTX) mit Pfad und " +
					"Dateigröße in Byte, optional gefiltert auf einen Ordner (Präfix). Diese Dateien " +
					"tauchen NICHT bei list_notes auf. Nutze read_document, um den Textinhalt einer " +
					"gefundenen Datei zu lesen.",
				parameters: {
					type: "object",
					properties: {
						folder: {
							type: "string",
							description:
								"Optionaler Ordner-Präfix, z. B. '03 Projekte'. Leer = ganzer Vault.",
						},
					},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "read_document",
				description:
					"Extrahiert den Textinhalt eines PDF-, Word- (.docx) oder PowerPoint- (.pptx) " +
					"Dokuments aus dem Vault. Nutze dies für Angebote, Rechnungen, QV-Protokolle, " +
					"Publikationen oder andere Dateien, die nicht als Markdown-Notiz vorliegen. " +
					"Bei PDFs mit reinen Bild-Scans (kein eingebetteter Text) kann das Ergebnis leer sein.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"Pfad zum Dokument relativ zum Vault-Root, inkl. Dateiendung (.pdf/.docx/.pptx).",
						},
					},
					required: ["path"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "search_vault",
				description:
					"Durchsucht alle Notizen nach einem Suchbegriff (in Dateiname und Inhalt). Gibt Treffer mit Pfad und kurzem Kontext zurück.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Suchbegriff (Groß-/Kleinschreibung egal).",
						},
					},
					required: ["query"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "create_note",
				description:
					"Erstellt eine NEUE Markdown-Notiz mit dem gegebenen Inhalt. Schlägt fehl, wenn die Notiz bereits existiert (dann edit_note oder append_to_note nutzen).",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Zielpfad relativ zum Vault-Root.",
						},
						content: { type: "string", description: "Markdown-Inhalt." },
					},
					required: ["path", "content"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "append_to_note",
				description:
					"BEVORZUGT zum Ergänzen: Hängt Text ans Ende einer Notiz an, ohne " +
					"Bestehendes zu verändern (nicht-destruktiv). Legt die Notiz an, falls " +
					"sie nicht existiert. Nutze dies, um Notizen zu erweitern/zu ergänzen.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Pfad relativ zum Vault-Root.",
						},
						content: { type: "string", description: "Anzuhängender Text." },
					},
					required: ["path", "content"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "edit_note",
				description:
					"GEFÄHRLICH/DESTRUKTIV: Ersetzt den GESAMTEN Inhalt einer Notiz. Alles " +
					"bisher Vorhandene, das du NICHT mitschickst, geht VERLOREN. Nutze dies " +
					"NUR, wenn der Nutzer ausdrücklich ein Überschreiben/Neuschreiben will — " +
					"und gib dann den vollständigen Inhalt inkl. ALLER bestehenden Teile zurück. " +
					"Zum bloßen Ergänzen stattdessen append_to_note verwenden.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Pfad relativ zum Vault-Root.",
						},
						content: { type: "string", description: "Neuer vollständiger Inhalt." },
					},
					required: ["path", "content"],
				},
			},
		},
	];
}

/** Werkzeuge, die den Vault verändern (für die Bestätigungs-Abfrage). */
const WRITE_TOOLS = new Set(["create_note", "append_to_note", "edit_note"]);

/** True, wenn das Werkzeug schreibend in den Vault eingreift. */
export function isWriteTool(name: string): boolean {
	return WRITE_TOOLS.has(name);
}

/** Kurzbeschreibung eines Tool-Calls für die UI-Anzeige (Chip). */
export function describeToolCall(call: ToolCall): string {
	let arg = "";
	try {
		const args = JSON.parse(call.function.arguments || "{}") as Record<string, string | undefined>;
		arg = args.path ?? args.query ?? args.folder ?? "";
	} catch {
		/* ignore */
	}
	return arg ? `${call.function.name}(${arg})` : call.function.name;
}

/**
 * Führt einen Tool-Call aus und gibt das Ergebnis als String zurück
 * (wird dem Modell als tool-Nachricht zurückgereicht).
 */
export async function executeToolCall(
	app: App,
	call: ToolCall
): Promise<string> {
	let args: Record<string, string>;
	try {
		args = JSON.parse(call.function.arguments || "{}") as Record<string, string>;
	} catch {
		return "Fehler: Argumente waren kein gültiges JSON.";
	}

	try {
		switch (call.function.name) {
			case "list_notes":
				return listNotes(app, args.folder);
			case "read_note":
				return readNote(app, args.path);
			case "list_documents":
				return listDocuments(app, args.folder);
			case "read_document":
				return await readDocument(app, args.path);
			case "search_vault":
				return searchVault(app, args.query);
			case "create_note":
				return await createNote(app, args.path, args.content);
			case "append_to_note":
				return await appendToNote(app, args.path, args.content);
			case "edit_note":
				return await editNote(app, args.path, args.content);
			default:
				return `Fehler: Unbekanntes Werkzeug "${call.function.name}".`;
		}
	} catch (err) {
		return `Fehler bei ${call.function.name}: ${
			err instanceof Error ? err.message : String(err)
		}`;
	}
}

// ------------------------------------------------------------------ Lesen

/** Ab dieser Bytegröße gilt eine Notiz in der list_notes-Ausgabe als "nahezu leer". */
const NEAR_EMPTY_BYTES = 50;

function listNotes(app: App, folder?: string): string {
	const prefix = folder ? normalizePath(folder) : "";
	let files = app.vault.getMarkdownFiles();
	if (prefix) {
		files = files.filter((f) => f.path.startsWith(prefix));
	}
	if (files.length === 0) {
		// Unterscheiden zwischen "Ordner existiert nicht" und "Ordner ist leer" —
		// sonst sehen beide Fälle für das Modell identisch aus und es zieht
		// falsche Schlüsse (z. B. eine veraltete Struktur-Referenz als reale,
		// aber leere Ordner interpretieren statt als nicht existent).
		if (prefix && !(app.vault.getAbstractFileByPath(prefix) instanceof TFolder)) {
			return `Ordner "${folder}" existiert nicht in diesem Vault.`;
		}
		return "Keine Notizen gefunden.";
	}

	// Dateigröße kommt aus Obsidians Metadaten (file.stat), OHNE den Inhalt zu
	// lesen — so kann das Modell leere/fast-leere Notizen direkt hier erkennen,
	// statt jede einzeln per read_note zu öffnen (teuer, sprengt schnell den
	// Kontext bei vielen Dateien).
	const lines = files.slice(0, MAX_LIST).map((f) => {
		const size = f.stat.size;
		const flag = size <= NEAR_EMPTY_BYTES ? "  ⚠ nahezu leer" : "";
		return `${f.path} (${size} B)${flag}`;
	});
	const more =
		files.length > MAX_LIST ? `\n… und ${files.length - MAX_LIST} weitere.` : "";
	return `${files.length} Notiz(en) mit Dateigröße (⚠ = ≤${NEAR_EMPTY_BYTES} Byte, vermutlich leer/nur Titel):\n${lines.join("\n")}${more}`;
}

async function readNote(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(asNotePath(path));
	if (!(file instanceof TFile)) {
		return `Fehler: Notiz "${path}" nicht gefunden.`;
	}
	const content = await app.vault.cachedRead(file);
	if (content.length > MAX_READ_CHARS) {
		return (
			content.slice(0, MAX_READ_CHARS) +
			`\n\n[… gekürzt, ${content.length - MAX_READ_CHARS} Zeichen ausgelassen]`
		);
	}
	return content || "(leere Notiz)";
}

/** Prüft, ob ein Pfad eine der unterstützten Dokument-Endungen hat. */
function isDocumentFile(f: TFile): boolean {
	return (DOCUMENT_EXTENSIONS as readonly string[]).includes(
		f.extension.toLowerCase()
	);
}

function listDocuments(app: App, folder?: string): string {
	const prefix = folder ? normalizePath(folder) : "";
	let files = app.vault.getFiles().filter(isDocumentFile);
	if (prefix) {
		files = files.filter((f) => f.path.startsWith(prefix));
	}
	if (files.length === 0) {
		if (prefix && !(app.vault.getAbstractFileByPath(prefix) instanceof TFolder)) {
			return `Ordner "${folder}" existiert nicht in diesem Vault.`;
		}
		return "Keine PDF-, DOCX- oder PPTX-Dateien gefunden.";
	}
	const lines = files
		.slice(0, MAX_LIST)
		.map((f) => `${f.path} (${f.stat.size} B)`);
	const more =
		files.length > MAX_LIST ? `\n… und ${files.length - MAX_LIST} weitere.` : "";
	return `${files.length} Dokument(e):\n${lines.join("\n")}${more}`;
}

/** Kürzt extrahierten Dokumenttext auf das gleiche Budget wie read_note. */
function truncateDocumentText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "(kein Text extrahiert — vermutlich reiner Bild-Scan ohne Text-Layer)";
	if (trimmed.length > MAX_READ_CHARS) {
		return (
			trimmed.slice(0, MAX_READ_CHARS) +
			`\n\n[… gekürzt, ${trimmed.length - MAX_READ_CHARS} Zeichen ausgelassen]`
		);
	}
	return trimmed;
}

/** Blob-URL des eingebetteten pdf.js-Workers — einmalig erzeugt, dann wiederverwendet. */
let pdfWorkerBlobUrl: string | null = null;

/**
 * pdf.js braucht `GlobalWorkerOptions.workerSrc`, sonst: "No
 * GlobalWorkerOptions.workerSrc specified." Da das Plugin nur EINE main.js
 * ausliefert (keine separate Datei/URL für den Worker), wird der Worker-
 * Quellcode zur Build-Zeit eingebettet (siehe pdf-worker-source.ts) und hier
 * als Blob-URL bereitgestellt — der Worker ist eine einzige, in sich
 * geschlossene .mjs-Datei ohne externe Imports, daher unproblematisch als
 * Blob zu laden.
 */
function ensurePdfWorker(): void {
	if (pdfWorkerBlobUrl) return;
	const blob = new Blob([PDF_WORKER_SOURCE], { type: "text/javascript" });
	pdfWorkerBlobUrl = URL.createObjectURL(blob);
	pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerBlobUrl;
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
	ensurePdfWorker();
	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
	const pdf = await loadingTask.promise;
	try {
		const pageTexts: string[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			const text = content.items
				.map((item) => ("str" in item ? item.str : ""))
				.join(" ");
			pageTexts.push(text);
		}
		// Seitenzahl explizit voranstellen — sonst muss das Modell sie aus dem
		// Fließtext raten (z. B. übers Inhaltsverzeichnis), was leicht danebengeht.
		return `[Dokument hat ${pdf.numPages} Seite(n)]\n\n${pageTexts.join("\n\n")}`;
	} finally {
		await pdf.destroy();
	}
}

async function extractDocxText(data: ArrayBuffer): Promise<string> {
	// mammoths Node-Build (lib/unzip.js) kennt nur {path|buffer|file}, nicht
	// {arrayBuffer} (das ist ein reiner Browser-Pfad) — deshalb hier explizit
	// in einen Node-Buffer wandeln statt das rohe ArrayBuffer durchzureichen.
	const result = await mammoth.extractRawText({
		buffer: Buffer.from(new Uint8Array(data)),
	});
	return result.value;
}

/** Extrahiert reinen Fließtext aus allen Folien einer .pptx (Zip aus Slide-XML). */
async function extractPptxText(data: ArrayBuffer): Promise<string> {
	const zip = await JSZip.loadAsync(data);
	const slideFiles = Object.keys(zip.files)
		.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
		.sort((a, b) => {
			const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
			const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
			return na - nb;
		});

	const slideTexts: string[] = [];
	for (const path of slideFiles) {
		const xml = await zip.files[path].async("text");
		// Text-Runs stehen in <a:t>…</a:t> — reicht für reinen Fließtext, ohne
		// eine volle XML-Parser-Abhängigkeit einzuführen.
		const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
		if (matches.length > 0) {
			const slideNum = path.match(/slide(\d+)\.xml/)?.[1] ?? "?";
			slideTexts.push(`--- Folie ${slideNum} ---\n${matches.join(" ")}`);
		}
	}
	return slideTexts.join("\n\n");
}

async function readDocument(app: App, path: string): Promise<string> {
	if (!path?.trim()) return "Fehler: kein Pfad angegeben.";
	const file = app.vault.getAbstractFileByPath(normalizePath(path.trim()));
	if (!(file instanceof TFile)) {
		return `Fehler: Dokument "${path}" nicht gefunden.`;
	}
	const ext = file.extension.toLowerCase();
	if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
		return `Fehler: Dateityp ".${ext}" wird nicht unterstützt (nur ${DOCUMENT_EXTENSIONS.join(", ")}). Für Markdown-Notizen read_note nutzen.`;
	}

	const data = await app.vault.readBinary(file);
	try {
		let text: string;
		switch (ext) {
			case "pdf":
				text = await extractPdfText(data);
				break;
			case "docx":
				text = await extractDocxText(data);
				break;
			case "pptx":
				text = await extractPptxText(data);
				break;
			default:
				return `Fehler: Dateityp ".${ext}" wird nicht unterstützt.`;
		}
		return truncateDocumentText(text);
	} catch (err) {
		return `Fehler beim Lesen von "${path}": ${
			err instanceof Error ? err.message : String(err)
		}`;
	}
}

/**
 * Normalisiert Text für tolerante Suche: Bindestriche, Unterstriche und Slashes
 * werden zu Leerzeichen, Mehrfach-Whitespace kollabiert. So findet
 * "recherche prompt" auch "Recherche-Prompt.md".
 */
function normalizeForSearch(s: string): string {
	return s
		.toLowerCase()
		.replace(/[-_/]+/g, " ")
		.replace(/\s+/g, " ");
}

async function searchVault(app: App, query: string): Promise<string> {
	if (!query?.trim()) return "Fehler: leerer Suchbegriff.";

	// In Suchwörter zerlegen — ALLE müssen vorkommen (AND), Reihenfolge/Trenner egal.
	const terms = normalizeForSearch(query)
		.split(" ")
		.filter((t) => t.length > 0);
	if (terms.length === 0) return "Fehler: leerer Suchbegriff.";

	const hits: string[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (hits.length >= MAX_SEARCH_HITS) break;

		const content = await app.vault.cachedRead(file);
		const hayName = normalizeForSearch(file.path);
		const hayContent = normalizeForSearch(content);

		// Treffer: alle Terme im Dateinamen ODER alle im Inhalt.
		const inName = terms.every((t) => hayName.includes(t));
		const inContent = terms.every((t) => hayContent.includes(t));
		if (!inName && !inContent) continue;

		// Snippet rund um den ersten Term-Treffer im Originaltext.
		const idx = content.toLowerCase().indexOf(terms[0]);
		let snippet = "";
		if (idx >= 0) {
			const start = Math.max(0, idx - 40);
			snippet = content
				.slice(start, idx + terms[0].length + 40)
				.replace(/\s+/g, " ")
				.trim();
		}
		hits.push(snippet ? `- ${file.path}: …${snippet}…` : `- ${file.path}`);
	}

	if (hits.length === 0) return `Keine Treffer für "${query}".`;
	return `${hits.length} Treffer für "${query}":\n${hits.join("\n")}`;
}

// --------------------------------------------------------------- Schreiben

async function createNote(
	app: App,
	path: string,
	content: string
): Promise<string> {
	const target = asNotePath(path);
	if (app.vault.getAbstractFileByPath(target)) {
		return `Fehler: "${target}" existiert bereits. Nutze edit_note oder append_to_note.`;
	}
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(`Euridian hat Notiz erstellt: ${target}`);
	return `Notiz "${target}" wurde erstellt.`;
}

async function appendToNote(
	app: App,
	path: string,
	content: string
): Promise<string> {
	const target = asNotePath(path);
	const file = app.vault.getAbstractFileByPath(target);

	if (file instanceof TFile) {
		await app.vault.append(file, "\n" + (content ?? ""));
		new Notice(`Euridian hat an Notiz angehängt: ${target}`);
		return `An "${target}" angehängt.`;
	}
	if (file instanceof TFolder) {
		return `Fehler: "${target}" ist ein Ordner.`;
	}
	// Existiert nicht → neu anlegen.
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(`Euridian hat Notiz erstellt: ${target}`);
	return `Notiz "${target}" existierte nicht und wurde erstellt.`;
}

async function editNote(
	app: App,
	path: string,
	content: string
): Promise<string> {
	const target = asNotePath(path);
	const file = app.vault.getAbstractFileByPath(target);

	if (file instanceof TFile) {
		await app.vault.modify(file, content ?? "");
		new Notice(`Euridian hat Notiz überschrieben: ${target}`);
		return `Inhalt von "${target}" wurde ersetzt.`;
	}
	if (file instanceof TFolder) {
		return `Fehler: "${target}" ist ein Ordner.`;
	}
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(`Euridian hat Notiz erstellt: ${target}`);
	return `Notiz "${target}" existierte nicht und wurde erstellt.`;
}
