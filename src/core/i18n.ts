/**
 * Übersetzungen der Oberfläche.
 *
 * Der englische Text ist zugleich der Schlüssel: `t("Send")` liefert bei
 * deutscher Obsidian-Sprache die Übersetzung aus `locales/de.ts`, sonst den
 * englischen Text selbst. Platzhalter stehen als `{name}` im Text und werden
 * aus `vars` befüllt. Texte, die an das Modell gehen (Prompts, Werkzeug-
 * Beschreibungen), laufen bewusst NICHT durch `t()`.
 */

import { getLanguage } from "obsidian";
import { VARIANT_DE } from "../variant/locale";
import { de as coreDe } from "./locales/de";

const de: Record<string, string> = { ...coreDe, ...VARIANT_DE };

/** Aktuelle Oberflächensprache: folgt der Sprache von Obsidian. */
function detectLanguage(): "en" | "de" {
	try {
		return getLanguage().toLowerCase().startsWith("de") ? "de" : "en";
	} catch {
		return "en";
	}
}

const language = detectLanguage();

export function currentLanguage(): "en" | "de" {
	return language;
}

/** Übersetzt einen englischen UI-Text und setzt `{platzhalter}` ein. */
export function t(text: string, vars?: Record<string, string | number>): string {
	const translated = language === "de" ? (de[text] ?? text) : text;
	if (!vars) return translated;
	return translated.replace(/\{(\w+)\}/g, (match: string, key: string) =>
		key in vars ? String(vars[key]) : match
	);
}
