/**
 * Gemeinsamen Kern zwischen den beiden Plugin-Repos abgleichen.
 *
 * Quelle der Wahrheit ist das Euridian-Repo. Das Schwester-Repo (Self-hosted LLM
 * Vault Agent) übernimmt daraus:
 *   src/core/**, src/main.ts, styles.css, tsconfig.json, esbuild.config.mjs,
 *   scripts/*.mjs (außer diesem Skript)
 * NICHT übernommen wird alles Variantenspezifische: src/variant/**,
 * manifest.json, package.json, README, LICENSE, versions.json, CI.
 *
 *   node scripts/sync-core.mjs <pfad-zum-quell-repo>          kopiert
 *   node scripts/sync-core.mjs <pfad-zum-quell-repo> --check  meldet Abweichungen
 *                                                             (Exit-Code 1 bei Drift)
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const sourceArg = args.find((a) => !a.startsWith("--"));

if (!sourceArg) {
	console.error("Aufruf: node scripts/sync-core.mjs <quell-repo> [--check]");
	process.exit(2);
}
const source = resolve(sourceArg);

/** Generierte Dateien, die nie mitkopiert werden. */
const IGNORED = new Set(["src/core/pdf-worker-source.ts"]);
/** Dateien, die zum Sync gehören (relativ zur Repo-Wurzel). */
const SHARED_FILES = ["src/main.ts", "styles.css", "tsconfig.json", "esbuild.config.mjs"];
const SHARED_DIRS = [
	["src/core", () => true],
	["scripts", (name) => name.endsWith(".mjs") && name !== "sync-core.mjs"],
];

function walk(root, dir, accept, out) {
	const abs = join(root, dir);
	if (!existsSync(abs)) return;
	for (const name of readdirSync(abs)) {
		const rel = join(dir, name);
		if (statSync(join(root, rel)).isDirectory()) walk(root, rel, accept, out);
		else if (accept(name) && !IGNORED.has(rel)) out.push(rel);
	}
}

const files = [...SHARED_FILES];
for (const [dir, accept] of SHARED_DIRS) walk(source, dir, accept, files);

let drift = 0;
for (const rel of files) {
	const from = join(source, rel);
	const to = join(target, rel);
	if (!existsSync(from)) continue;
	const same = existsSync(to) && readFileSync(from).equals(readFileSync(to));
	if (same) continue;
	drift++;
	if (check) {
		console.log(`✕ weicht ab: ${rel}`);
	} else {
		mkdirSync(dirname(to), { recursive: true });
		copyFileSync(from, to);
		console.log(`↻ ${rel}`);
	}
}

// Dateien im Ziel-Kern, die es in der Quelle nicht mehr gibt (nur Hinweis).
const extra = [];
walk(target, "src/core", () => true, extra);
for (const rel of extra) {
	if (!existsSync(join(source, rel))) console.log(`? nur im Ziel vorhanden: ${rel}`);
}

if (check) {
	if (drift) {
		console.error(`\n${drift} Datei(en) weichen vom Kern in ${relative(process.cwd(), source) || source} ab.`);
		process.exit(1);
	}
	console.log("✓ Kern identisch.");
} else {
	console.log(drift ? `\n✓ ${drift} Datei(en) aktualisiert.` : "✓ Bereits aktuell.");
}
