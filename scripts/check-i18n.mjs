/**
 * Prüft die Übersetzungen: jeder `t("…")`-Aufruf in src/ braucht einen Eintrag in
 * src/core/locales/de.ts oder src/variant/locale.ts, und Einträge ohne Aufruf
 * werden gemeldet. Exit-Code 1 bei fehlenden Übersetzungen.
 *
 *   node scripts/check-i18n.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

const DICTIONARIES = ["src/core/locales/de.ts", "src/variant/locale.ts"];
const entryRe = /^\t("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),?$/gm;
const translations = new Map();
for (const file of DICTIONARIES) {
	const text = readFileSync(join(root, file), "utf8");
	for (const m of text.matchAll(entryRe)) {
		translations.set(JSON.parse(m[1]), JSON.parse(m[2]));
	}
}

const used = new Set();
const callRe = /\bt\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
for (const file of walk(join(root, "src"))) {
	if (file.includes("locales") || file.endsWith("locale.ts") || file.includes("pdf-worker")) continue;
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(callRe)) used.add(new Function(`return ${m[1]}`)());
}

const missing = [...used].filter((k) => !translations.has(k));
const unused = [...translations.keys()].filter((k) => !used.has(k));
for (const k of missing) console.log(`✕ missing German translation: ${JSON.stringify(k)}`);
for (const k of unused) console.log(`? unused translation: ${JSON.stringify(k)}`);
console.log(`${used.size} strings, ${translations.size} translations.`);
process.exit(missing.length ? 1 : 0);
