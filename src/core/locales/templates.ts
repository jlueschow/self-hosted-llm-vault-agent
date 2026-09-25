/**
 * Mitgelieferte Prompt-Vorlagen (Slash-Commands), je Oberflächensprache.
 * Die Vorlagen landen in data.json und sind danach frei anpassbar; bestehende
 * Nutzer behalten ihre gespeicherte Liste.
 */

import { PromptTemplate } from "../types";

export const TEMPLATES_EN: PromptTemplate[] = [
	{
		name: "summarize",
		description: "Summarize the current note concisely",
		template:
			"Summarize the following note concisely in bullet points:\n\n{{note}}",
	},
	{
		name: "translate",
		description: "Translate text into English",
		template: "Translate the following text into English:\n\n{{input}}",
	},
	{
		name: "improve",
		description: "Improve the style of the selected text (natural wording, no AI patterns)",
		template:
			"Improve the style and grammar of the following text without changing its meaning.\n" +
			"Avoid typical AI writing patterns:\n" +
			"- Use dashes sparingly; do not pile them up instead of commas or colons\n" +
			'- No promotional or inflated language ("plays a significant role", "underscores the importance")\n' +
			'- No mechanical sentence openers ("Moreover", "Additionally", "Furthermore") in a row\n' +
			'- No "not only ... but also ..." as a standard figure\n' +
			"- Plain verbs instead of stiff synonyms (wrote instead of authored, helped instead of provided assistance)\n" +
			"- No forced synonym rotation; repeating a word is fine\n" +
			'- Use bold text and lists sparingly; avoid the "**Term:** explanation" pattern\n' +
			'- No "conclusion" or "challenges and outlook" block at the end\n' +
			'- No dialogue or meta leftovers ("Here is the text", "I hope this helps")\n\n' +
			"Text:\n{{selection}}",
	},
	{
		name: "explain",
		description: "Explain the selected text simply",
		template:
			"Explain the following text in a simple and understandable way:\n\n{{selection}}",
	},
	{
		name: "continue",
		description: "Continue the note in the same style",
		template:
			"Continue the following note in the same style in a meaningful way:\n\n{{note}}",
	},
];

export const TEMPLATES_DE: PromptTemplate[] = [
	{
		name: "zusammenfassen",
		description: "Aktuelle Notiz prägnant zusammenfassen",
		template:
			"Fasse die folgende Notiz prägnant in Stichpunkten zusammen:\n\n{{note}}",
	},
	{
		name: "übersetzen",
		description: "Text ins Englische übersetzen",
		template: "Übersetze den folgenden Text ins Englische:\n\n{{input}}",
	},
	{
		name: "verbessern",
		description: "Markierten Text stilistisch verbessern (natürliches Deutsch, keine KI-Muster)",
		template:
			"Verbessere Stil und Grammatik des folgenden Textes, ohne den Sinn zu verändern.\n" +
			"Vermeide dabei typische KI-Textmuster:\n" +
			"- Gedankenstriche sparsam einsetzen, nicht anstelle von Komma/Doppelpunkt häufen\n" +
			'- Keine Werbe-/Feiersprache ("spielt eine bedeutende Rolle", "unterstreicht die Bedeutung")\n' +
			'- Keine mechanischen Satzanfänge ("Darüber hinaus", "Zusätzlich", "Außerdem") in Folge\n' +
			'- Kein "nicht nur..., sondern auch..." als Standardfigur\n' +
			"- Schlichte Verben statt steifer Synonyme (schrieb statt verfasste, half statt leistete Unterstützung)\n" +
			"- Keine erzwungene Synonym-Rotation — Wortwiederholung ist erlaubt\n" +
			'- Fettdruck und Listen sparsam; kein Schema "**Begriff:** Erklärung"\n' +
			'- Kein "Fazit"- oder "Herausforderungen/Ausblick"-Block am Ende\n' +
			'- Keine Dialog-/Meta-Reste ("Hier ist der Text", "Ich hoffe das hilft")\n\n' +
			"Text:\n{{selection}}",
	},
	{
		name: "erklären",
		description: "Markierten Text einfach erklären",
		template:
			"Erkläre den folgenden Text einfach und verständlich:\n\n{{selection}}",
	},
	{
		name: "fortsetzen",
		description: "Notiz im gleichen Stil weiterschreiben",
		template:
			"Schreibe die folgende Notiz im gleichen Stil sinnvoll weiter:\n\n{{note}}",
	},
];
