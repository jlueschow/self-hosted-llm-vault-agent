/**
 * Bettet den pdf.js-Worker (aus pdfjs-dist) als String-Konstante in eine
 * generierte TS-Datei ein.
 *
 * Warum: pdfjs-dist liefert den Worker nur als eigenständige .mjs-Datei, die
 * normalerweise per URL referenziert wird (`GlobalWorkerOptions.workerSrc`).
 * In einem einzeln gebauten Obsidian-Plugin (ein main.js, keine separate
 * Asset-Pipeline/kein Server) gibt es keine sinnvolle URL dafür. Stattdessen
 * wird der Worker-Quellcode zur Build-Zeit eingebettet und zur Laufzeit als
 * Blob-URL bereitgestellt (siehe vault-tools.ts, ensurePdfWorker()).
 *
 * Läuft vor jedem Build (siehe package.json "prepackage"/"predev"-Skripte).
 * Ausgabe ist eine generierte Datei (.gitignore) — nicht von Hand editieren.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = join(
	projectRoot,
	"node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"
);
const outPath = join(projectRoot, "src/core/pdf-worker-source.ts");

const source = readFileSync(workerPath, "utf8");

writeFileSync(
	outPath,
	`// AUTO-GENERIERT von scripts/generate-pdf-worker.mjs — nicht von Hand editieren.\n` +
		`// Quelle: node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs\n` +
		`export const PDF_WORKER_SOURCE = ${JSON.stringify(source)};\n`
);

console.log(
	`✓ pdf-worker-source.ts generiert (${(source.length / 1024).toFixed(0)} KB Worker-Quellcode eingebettet)`
);
