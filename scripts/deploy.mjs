/**
 * Kopiert die Build-Artefakte (main.js, manifest.json, styles.css) als ECHTE
 * Dateien in den Obsidian-Plugin-Ordner. Symlinks scheiden aus, weil Obsidian
 * ihnen beim Plugin-Scan nicht folgt.
 *
 * Zielordner wird ausschließlich über die Umgebungsvariable EURIDIAN_PLUGIN_DIR
 * gesetzt (z. B. ".../DeineVault/.obsidian/plugins/euridian") — kein Fallback,
 * damit keine persönlichen Pfade im Repo landen.
 *
 * Doppelrolle: direkt ausführbar (`node scripts/deploy.mjs`) UND importierbar
 * als `deploy()` (vom Watch-Build in esbuild.config.mjs).
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const pluginDir = process.env.EURIDIAN_PLUGIN_DIR;

const files = [
	["dist/main.js", "main.js"],
	["manifest.json", "manifest.json"],
	["styles.css", "styles.css"],
];

/** Kopiert die Artefakte ins Plugin-Verzeichnis. Gibt true bei Erfolg zurück. */
export function deploy() {
	if (!pluginDir) {
		console.error(
			"✕ EURIDIAN_PLUGIN_DIR ist nicht gesetzt.\n" +
				'  export EURIDIAN_PLUGIN_DIR="/Pfad/zu/DeinerVault/.obsidian/plugins/euridian"'
		);
		return false;
	}
	mkdirSync(pluginDir, { recursive: true });

	for (const [src, dest] of files) {
		const srcPath = join(projectRoot, src);
		if (!existsSync(srcPath)) {
			console.error(`✕ Fehlt: ${src} — erst bauen.`);
			return false;
		}
		copyFileSync(srcPath, join(pluginDir, dest));
		console.log(`✓ ${dest}`);
	}

	console.log(`Deployed → ${pluginDir}`);
	return true;
}

// Nur wenn direkt gestartet (npm run deploy), nicht beim Import.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (!deploy()) process.exit(1);
	console.log("Obsidian neu laden (oder Community-Plugins aus/an), damit es erkannt wird.");
}
