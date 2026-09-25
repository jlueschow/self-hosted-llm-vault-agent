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
import { VARIANT } from "../variant";
import { t } from "./i18n";
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
					"Lists Markdown notes in the vault (path + file size in bytes), optionally " +
					"filtered to a folder (prefix). USE THE FILE SIZE to spot empty or nearly empty " +
					"notes (⚠ marker at ≤50 bytes); do NOT call read_note " +
					"for every single file, which is needlessly expensive and blows the context " +
					"with many files. Use read_note only for notes whose content you really need.",
				parameters: {
					type: "object",
					properties: {
						folder: {
							type: "string",
							description:
								"Optional folder prefix, e.g. '03 Projects'. Empty = whole vault.",
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
					"Reads the full content of a Markdown note from the vault.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Path to the note, relative to the vault root.",
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
					"Lists non-Markdown documents in the vault (PDF, DOCX, PPTX) with path and " +
					"file size in bytes, optionally filtered to a folder (prefix). These files " +
					"do NOT appear in list_notes. Use read_document to read the text content of " +
					"a file you found.",
				parameters: {
					type: "object",
					properties: {
						folder: {
							type: "string",
							description:
								"Optional folder prefix, e.g. '03 Projects'. Empty = whole vault.",
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
					"Extracts the text content of a PDF, Word (.docx) or PowerPoint (.pptx) " +
					"document from the vault. Use it for quotes, invoices, meeting minutes, " +
					"publications or other files that are not Markdown notes. " +
					"For PDFs that are pure image scans (no embedded text) the result can be empty.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"Path to the document, relative to the vault root, including the extension (.pdf/.docx/.pptx).",
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
					"Searches all notes for a search term (file name and content). Returns hits with path and short context.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search term (case-insensitive).",
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
					"Creates a NEW Markdown note with the given content. Fails if the note already exists (then use edit_note or append_to_note).",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Target path, relative to the vault root.",
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
					"PREFERRED for adding content: appends text to the end of a note without " +
					"changing existing content (non-destructive). Creates the note if " +
					"it does not exist. Use this to extend or add to notes.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Path, relative to the vault root.",
						},
						content: { type: "string", description: "Text to append." },
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
					"DANGEROUS/DESTRUCTIVE: Replaces the ENTIRE content of a note. Everything " +
					"existing that you do NOT send along is LOST. Use this " +
					"ONLY if the user explicitly wants an overwrite or rewrite, " +
					"and then return the complete content including ALL existing parts. " +
					"To merely add content use append_to_note instead.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Path, relative to the vault root.",
						},
						content: { type: "string", description: "New complete content." },
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
		return "Error: the arguments were not valid JSON.";
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
				return `Error: unknown tool "${call.function.name}".`;
		}
	} catch (err) {
		return `Error in ${call.function.name}: ${
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
			return `Folder "${folder}" does not exist in this vault.`;
		}
		return "No notes found.";
	}

	// Dateigröße kommt aus Obsidians Metadaten (file.stat), OHNE den Inhalt zu
	// lesen — so kann das Modell leere/fast-leere Notizen direkt hier erkennen,
	// statt jede einzeln per read_note zu öffnen (teuer, sprengt schnell den
	// Kontext bei vielen Dateien).
	const lines = files.slice(0, MAX_LIST).map((f) => {
		const size = f.stat.size;
		const flag = size <= NEAR_EMPTY_BYTES ? "  ⚠ nearly empty" : "";
		return `${f.path} (${size} B)${flag}`;
	});
	const more =
		files.length > MAX_LIST ? `\n… and ${files.length - MAX_LIST} more.` : "";
	return `${files.length} note(s) with file size (⚠ = ≤${NEAR_EMPTY_BYTES} bytes, probably empty or title only):\n${lines.join("\n")}${more}`;
}

async function readNote(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(asNotePath(path));
	if (!(file instanceof TFile)) {
		return `Error: note "${path}" not found.`;
	}
	const content = await app.vault.cachedRead(file);
	if (content.length > MAX_READ_CHARS) {
		return (
			content.slice(0, MAX_READ_CHARS) +
			`\n\n[… truncated, ${content.length - MAX_READ_CHARS} characters omitted]`
		);
	}
	return content || "(empty note)";
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
			return `Folder "${folder}" does not exist in this vault.`;
		}
		return "No PDF, DOCX or PPTX files found.";
	}
	const lines = files
		.slice(0, MAX_LIST)
		.map((f) => `${f.path} (${f.stat.size} B)`);
	const more =
		files.length > MAX_LIST ? `\n… and ${files.length - MAX_LIST} more.` : "";
	return `${files.length} Dokument(e):\n${lines.join("\n")}${more}`;
}

/** Kürzt extrahierten Dokumenttext auf das gleiche Budget wie read_note. */
function truncateDocumentText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "(no text extracted; probably a pure image scan without a text layer)";
	if (trimmed.length > MAX_READ_CHARS) {
		return (
			trimmed.slice(0, MAX_READ_CHARS) +
			`\n\n[… truncated, ${trimmed.length - MAX_READ_CHARS} characters omitted]`
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
	if (!path?.trim()) return "Error: no path given.";
	const file = app.vault.getAbstractFileByPath(normalizePath(path.trim()));
	if (!(file instanceof TFile)) {
		return `Error: document "${path}" not found.`;
	}
	const ext = file.extension.toLowerCase();
	if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
		return `Error: file type ".${ext}" is not supported (only ${DOCUMENT_EXTENSIONS.join(", ")}). Use read_note for Markdown notes.`;
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
				return `Error: file type ".${ext}" is not supported.`;
		}
		return truncateDocumentText(text);
	} catch (err) {
		return `Error reading "${path}": ${
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
	if (!query?.trim()) return "Error: empty search term.";

	// In Suchwörter zerlegen — ALLE müssen vorkommen (AND), Reihenfolge/Trenner egal.
	const terms = normalizeForSearch(query)
		.split(" ")
		.filter((t) => t.length > 0);
	if (terms.length === 0) return "Error: empty search term.";

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

	if (hits.length === 0) return `No hits for "${query}".`;
	return `${hits.length} hit(s) for "${query}":\n${hits.join("\n")}`;
}

// --------------------------------------------------------------- Schreiben

async function createNote(
	app: App,
	path: string,
	content: string
): Promise<string> {
	const target = asNotePath(path);
	if (app.vault.getAbstractFileByPath(target)) {
		return `Error: "${target}" already exists. Use edit_note or append_to_note.`;
	}
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(t("{name} created a note: {path}", { name: VARIANT.name, path: target }));
	return `Note "${target}" was created.`;
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
		new Notice(t("{name} appended to a note: {path}", { name: VARIANT.name, path: target }));
		return `Appended to "${target}".`;
	}
	if (file instanceof TFolder) {
		return `Error: "${target}" is a folder.`;
	}
	// Existiert nicht → neu anlegen.
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(t("{name} created a note: {path}", { name: VARIANT.name, path: target }));
	return `Note "${target}" did not exist and was created.`;
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
		new Notice(t("{name} overwrote a note: {path}", { name: VARIANT.name, path: target }));
		return `Content of "${target}" was replaced.`;
	}
	if (file instanceof TFolder) {
		return `Error: "${target}" is a folder.`;
	}
	await ensureParentFolder(app, target);
	await app.vault.create(target, content ?? "");
	new Notice(t("{name} created a note: {path}", { name: VARIANT.name, path: target }));
	return `Note "${target}" did not exist and was created.`;
}
