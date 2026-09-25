/** Deutsche Übersetzungen des gemeinsamen Kerns (Schlüssel = englischer UI-Text). */
export const de: Record<string, string> = {
	"\"{name}\" allows at most {max} images per request. Resending with the latest {max}.":
		"„{name}“ erlaubt max. {max} Bilder pro Anfrage. Ich sende mit den neuesten {max} erneut.",
	"\"{name}\" does not accept images. Resending without images. For images, choose a model with image support.":
		"„{name}“ nimmt keine Bilder an. Ich sende ohne Bilder erneut. Für Bilder ein Modell mit Bildunterstützung wählen.",
	"\"{name}\" rejected images earlier, so the image is not sent. Switch the model or start a new chat.":
		"„{name}“ hat Bilder zuvor abgelehnt, das Bild wird nicht mitgeschickt. Modell wechseln oder neuen Chat starten.",
	"(actions performed, see above)":
		"(Aktionen ausgeführt, siehe oben)",
	"(attachments)":
		"(Anhänge)",
	"(empty content)":
		"(leerer Inhalt)",
	"(no answer)":
		"(keine Antwort)",
	"0 = deterministic, 2 = very creative.":
		"0 = deterministisch, 2 = sehr kreativ.",
	"Add":
		"Hinzufügen",
	"Add to {name} chat":
		"Zu {name}-Chat hinzufügen",
	"Advanced":
		"Erweitert",
	"Advanced settings":
		"Erweiterte Einstellungen",
	"Append to note: {path}":
		"An Notiz anhängen: {path}",
	"Apply":
		"Übernehmen",
	"Ask a question to get started.":
		"Stell eine Frage, um zu starten.",
	"Ask something … (/ templates, @ notes, Enter sends, Shift+Enter = new line)":
		"Frag etwas … (/ Vorlagen, @ Notizen, Enter sendet, Shift+Enter = Zeile)",
	"Asks before creating, appending to or overwriting notes, with a preview. Reading and searching never ask. Recommended: prevents unrequested or hallucinated notes.":
		"Fragt vor dem Erstellen, Anhängen oder Überschreiben von Notizen nach (mit Vorschau). Lesen und Suchen bleiben ohne Rückfrage. Empfohlen, verhindert ungefragte oder halluzinierte Notizen.",
	"Attach file":
		"Datei anhängen",
	"Attach selected text as context":
		"Markierten Text als Kontext anhängen",
	"Attach selection as context":
		"Auswahl als Kontext anhängen",
	"Backend of this chat: {label}":
		"Backend dieses Chats: {label}",
	"Behavior":
		"Verhalten",
	"Brave Search (API key)":
		"Brave Search (API-Key)",
	"Brave Search API key":
		"Brave-Search-API-Key",
	"Brave Search is not reachable. Check your internet connection.":
		"Brave Search nicht erreichbar. Internetverbindung prüfen.",
	"Brave Search: invalid API key. Check it in the settings.":
		"Brave Search: API-Key ungültig. In den Einstellungen prüfen.",
	"Brave Search: rate limit reached. Please wait a moment.":
		"Brave Search: Rate-Limit erreicht. Bitte kurz warten.",
	"Cancel":
		"Abbrechen",
	"Changes (red = removed, green = new):":
		"Änderungen (rot = entfernt, grün = neu):",
	"Chat":
		"Chat",
	"Chat {n}":
		"Chat {n}",
	"Check your internet connection.":
		"Internetverbindung prüfen.",
	"Close":
		"Schließen",
	"Compress history automatically":
		"Verlauf automatisch komprimieren",
	"Confirm before writing":
		"Bestätigung vor Schreibaktionen",
	"Confirm write action":
		"Schreibaktion bestätigen",
	"Copied.":
		"Kopiert.",
	"Copy":
		"Kopieren",
	"Create new note: {path}":
		"Neue Notiz erstellen: {path}",
	"Current note as context":
		"Aktuelle Notiz als Kontext",
	"Description":
		"Beschreibung",
	"Discard":
		"Verwerfen",
	"Drop files here":
		"Dateien hier ablegen",
	"DuckDuckGo (no account)":
		"DuckDuckGo (ohne Account)",
	"DuckDuckGo is blocking the request (bot check). Try again later or switch to Brave Search in the settings.":
		"DuckDuckGo blockiert die Anfrage (Bot-Abfrage). Später erneut versuchen oder in den Einstellungen Brave Search nutzen.",
	"DuckDuckGo is not reachable. Check your internet connection.":
		"DuckDuckGo nicht erreichbar. Internetverbindung prüfen.",
	"DuckDuckGo needs no account but is unofficial and can be blocked after many requests. Brave Search is more stable but needs a free API key.":
		"DuckDuckGo braucht keinen Account, ist aber inoffiziell und kann bei vielen Anfragen blockiert werden. Brave Search ist stabiler, braucht aber einen kostenlosen API-Key.",
	"Edit":
		"Bearbeiten",
	"Edit selection with AI (inline edit)":
		"Inline-Edit: Auswahl mit KI bearbeiten",
	"Edit with {name} (inline edit)":
		"Mit {name} bearbeiten (Inline-Edit)",
	"Editing …":
		"Wird bearbeitet …",
	"Enable web search":
		"Websuche aktivieren",
	"Enter the API key first.":
		"Erst den API-Key eintragen.",
	"Fetches the model list from the backend.":
		"Ruft die Modell-Liste des Backends ab.",
	"File could not be read.":
		"Datei konnte nicht gelesen werden.",
	"Free key at brave.com/search/api (free tier: 2000 requests per month).":
		"Kostenloser Key unter brave.com/search/api (Free-Tier: 2000 Anfragen pro Monat).",
	"Gives the agent the \"search_web\" tool. The search always runs locally on your computer, even if your server has no internet access itself.":
		"Gibt dem Agenten das Werkzeug „search_web“. Die Suche läuft immer lokal über deinen Rechner, auch wenn dein Server selbst keinen Internetzugang hat.",
	"How should the text be changed?":
		"Wie soll der Text geändert werden?",
	"Inline edit":
		"Inline-Edit",
	"Inline edit applied.":
		"Inline-Edit übernommen.",
	"Inline edit: error":
		"Inline-Edit: Fehler",
	"Inline edit: preview":
		"Inline-Edit: Vorschau",
	"Insert":
		"Einfügen",
	"Insert into note":
		"In Notiz einfügen",
	"Insert into note?":
		"In Notiz einfügen?",
	"Inserted into \"{note}\".":
		"In „{note}“ eingefügt.",
	"Instead of discarding dropped messages entirely, keep them as an LLM summary (one extra background request the first time the limit is exceeded). Works like auto-compact in Claude Code.":
		"Statt entfernte Nachrichten komplett zu verwerfen, bleiben sie als LLM-Kurzfassung erhalten (ein zusätzlicher Hintergrund-Request, sobald die Grenze erstmals überschritten wird). Funktioniert wie Auto-Compact in Claude Code.",
	"Instruction":
		"Anweisung",
	"Invalid URL: {url}":
		"Ungültige URL: {url}",
	"Lets the model read, search, create and edit notes (function calling). Deleting is blocked. The model must support tool calling.":
		"Erlaubt dem Modell, Notizen zu lesen, zu durchsuchen, zu erstellen und zu ändern (Function Calling). Löschen ist gesperrt. Das Modell muss Tool-Calling unterstützen.",
	"Max. context messages":
		"Max. Kontext-Nachrichten",
	"Model of this chat: {model}":
		"Modell dieses Chats: {model}",
	"Name":
		"Name",
	"Name (no spaces) and short description.":
		"Name (ohne Leerzeichen) und Kurzbeschreibung.",
	"Name and prompt text are required.":
		"Name und Prompt-Text sind nötig.",
	"New tab":
		"Neuer Tab",
	"New template":
		"Neue Vorlage",
	"No Brave Search API key set (settings, web search).":
		"Kein Brave-Search-API-Key hinterlegt (Einstellungen, Websuche).",
	"No active note open to insert into.":
		"Keine aktive Notiz zum Einfügen geöffnet.",
	"No change suggested.":
		"Keine Änderung vorgeschlagen.",
	"No text selected.":
		"Kein Text markiert.",
	"Note":
		"Notiz",
	"Note: {note}":
		"Notiz: {note}",
	"Oldest messages beyond this limit are dropped from the full context (saves tokens).":
		"Die ältesten Nachrichten über dieser Grenze fallen aus dem vollständigen Kontext (spart Token).",
	"Ollama is not reachable. Is the server running? (`ollama serve`)":
		"Ollama ist nicht erreichbar. Läuft der Server? (`ollama serve`)",
	"Ollama: could not load model \"{model}\" (HTTP {status}).":
		"Ollama: Modell „{model}“ konnte nicht geladen werden (HTTP {status}).",
	"Open chat":
		"Chat öffnen",
	"Optional persona or style instructions for the AI.":
		"Optionale Persona oder Stilvorgabe für die KI.",
	"Please enter an instruction.":
		"Bitte eine Anweisung eingeben.",
	"Prompt templates (slash commands)":
		"Prompt-Vorlagen (Slash-Commands)",
	"Prompt text":
		"Prompt-Text",
	"Reject":
		"Ablehnen",
	"Remove":
		"Entfernen",
	"Request cancelled.":
		"Anfrage abgebrochen.",
	"Retry":
		"Neu",
	"Runs a test search.":
		"Führt eine Testsuche aus.",
	"Search for a file to attach …":
		"Datei suchen und anhängen …",
	"Search provider":
		"Suchanbieter",
	"Select some text first.":
		"Bitte zuerst Text markieren.",
	"Selected text:":
		"Markierter Text:",
	"Selection added to the context.":
		"Auswahl zum Kontext hinzugefügt.",
	"Selection attached (truncated to {max} characters).":
		"Auswahl angehängt (auf {max} Zeichen gekürzt).",
	"Selection: {note} ({count} chars)":
		"Auswahl: {note} ({count} Z.)",
	"Send":
		"Senden",
	"Sends the content of the open note along as system context.":
		"Sendet den Inhalt der geöffneten Notiz als System-Kontext mit.",
	"Shows more options (context, system prompt, temperature, templates, …). The defaults suit most people.":
		"Zeigt weitere Optionen (Kontext, System-Prompt, Temperatur, Vorlagen, …). Die Standardwerte passen für die meisten.",
	"Stop":
		"Stopp",
	"Stream error: {message}":
		"Stream-Fehler: {message}",
	"System prompt":
		"System-Prompt",
	"Temperature":
		"Temperatur",
	"Test":
		"Testen",
	"Test connection":
		"Verbindung testen",
	"Testing …":
		"Teste …",
	"Text and image files are added to the context":
		"Text- und Bilddateien werden in den Kontext aufgenommen",
	"The current note is sent along as context.":
		"Die aktuelle Notiz wird als Kontext mitgesendet.",
	"Thinking / reasoning":
		"Thinking / Reasoning",
	"Translate into English:\n\n{{input}}":
		"Übersetze ins Englische:\n\n{{input}}",
	"Try again":
		"Erneut",
	"Turns on the model's \"thinking\". Off is faster and cheaper (reasoning_effort: none).":
		"Aktiviert das „Nachdenken“ des Modells. Aus ist schneller und günstiger (reasoning_effort: none).",
	"Type / in the chat to insert a template. Placeholders: {{input}} (cursor for your text), {{selection}} (selected text), {{note}} (whole note), {{title}} (note title).":
		"Tippe / im Chat, um eine Vorlage einzufügen. Platzhalter: {{input}} (Cursor für deinen Text), {{selection}} (markierter Text), {{note}} (ganze Notiz), {{title}} (Notiztitel).",
	"Unexpected error: {error}":
		"Unerwarteter Fehler: {error}",
	"Unknown error: {error}":
		"Unbekannter Fehler: {error}",
	"Vault agent":
		"Vault-Agent",
	"Vault path to a short instructions file for {name} (for example vault conventions or folder structure). Leave empty for none. Default: {path} in the vault root. Do not enter your vault-wide CLAUDE.md: large instruction files written for other assistants derail the agent.":
		"Vault-Pfad zu einer kurzen Instruktionsdatei für {name} (z. B. Vault-Konventionen, Ordnerstruktur). Leer lassen = keine. Standard: {path} im Vault-Root. NICHT die vault-weite CLAUDE.md eintragen: große Instruktionsdateien für andere Assistenten bringen den Agenten aus dem Tritt.",
	"Web search (optional)":
		"Websuche (optional)",
	"Which service provides the answers.":
		"Welcher Dienst die Antworten liefert.",
	"With placeholders, for example \"Translate: {{input}}\".":
		"Mit Platzhaltern, z. B. „Übersetze: {{input}}“.",
	"You are a helpful assistant …":
		"Du bist ein hilfreicher Assistent …",
	"e.g. shorter, more formal, into English":
		"z. B. kürzer, formeller, ins Englische",
	"last answer: {count} tokens":
		"letzte Antwort: {count} Token",
	"thinking 0 s":
		"denkt 0 s",
	"thinking {secs} s":
		"denkt {secs} s",
	"thinking {secs} s (maybe a queue on the server)":
		"denkt {secs} s (evtl. Warteschlange auf dem Server)",
	"unknown":
		"unbekannt",
	"{count} image":
		"{count} Bild",
	"{count} images":
		"{count} Bilder",
	"{file} added to the context.":
		"{file} zum Kontext hinzugefügt.",
	"{file} could not be read.":
		"{file} konnte nicht gelesen werden.",
	"{file} is already attached.":
		"{file} ist bereits angehängt.",
	"{file} is too large (max. {mb} MB).":
		"{file} ist zu groß (max. {mb} MB).",
	"{file}: file type not supported (text and image files only).":
		"{file}: Dateityp nicht unterstützt (nur Text- und Bilddateien).",
	"{file}: truncated to {max} characters.":
		"{file}: auf {max} Zeichen gekürzt.",
	"{label} is not reachable.":
		"{label} ist nicht erreichbar.",
	"{label}: authentication failed. Check the API key / product ID.":
		"{label}: Authentifizierung fehlgeschlagen. API-Key / Product-ID prüfen.",
	"{label}: invalid request. \"{model}\" may not support a parameter.":
		"{label}: Ungültige Anfrage. Evtl. unterstützt „{model}“ einen Parameter nicht.",
	"{label}: model \"{model}\" or endpoint not found.":
		"{label}: Modell „{model}“ oder Endpunkt nicht gefunden.",
	"{label}: no more data for {seconds} s. The connection hangs mid-stream (server or proxy stopped answering without closing the connection). Check network/VPN or try again.":
		"{label}: Keine weiteren Daten seit {seconds} s. Die Verbindung hängt mitten im Stream (Server oder Proxy antwortet nicht mehr, ohne die Verbindung zu schließen). Prüfe Netzwerk/VPN oder versuch es erneut.",
	"{label}: no response for {minutes} minutes. The server has not even started answering. The request may be stuck in a server-side queue (limited parallel requests). Ask the server operator, or try again.":
		"{label}: Keine Antwort seit {minutes} Minuten. Der Server hat noch nicht einmal mit der Antwort begonnen. Möglicherweise steckt die Anfrage in einer serverseitigen Warteschlange (begrenzte parallele Anfragen). Frag ggf. beim Server-Betreiber nach, oder versuch es erneut.",
	"{label}: rate limit reached. Please wait a moment.":
		"{label}: Rate-Limit erreicht. Bitte kurz warten.",
	"{name} appended to a note: {path}":
		"{name} hat an Notiz angehängt: {path}",
	"{name} created a note: {path}":
		"{name} hat Notiz erstellt: {path}",
	"{name} instructions file":
		"{name}-Instruktionsdatei",
	"{name} overwrote a note: {path}":
		"{name} hat Notiz überschrieben: {path}",
	"{name}: maximum number of tool steps reached.":
		"{name}: Maximale Werkzeug-Schritte erreicht.",
	"{name}: open chat":
		"{name}: Chat öffnen",
	"{old} → {new} characters ({delta})":
		"{old} → {new} Zeichen ({delta})",
	"~{count} tokens in context":
		"~{count} Token im Kontext",
	"— cancelled —":
		"— abgebrochen —",
	"— no model —":
		"— kein Modell —",
	"⚠ Overwrite the ENTIRE note: {path}":
		"⚠ Notiz KOMPLETT überschreiben: {path}",
	"⚠ Text is still selected in \"{note}\". It will be replaced by the answer. Is this really the right note?":
		"⚠ In „{note}“ ist noch Text markiert. Er wird durch die Antwort ersetzt. Ist das wirklich die richtige Notiz?",
	"✓ Connected to {label}. {count} model(s) found.":
		"✓ Verbunden mit {label}. {count} Modell(e) gefunden.",
	"✓ {provider} reachable.":
		"✓ {provider} erreichbar.",
};
