# Self-hosted LLM Vault Agent for Obsidian

Chat with your own LLM server from an Obsidian sidebar and let the model read,
search and write your notes. Works with **Ollama**, **vLLM**, **LM Studio**,
**llama.cpp server**, LiteLLM, or any server that speaks the OpenAI-compatible
`/v1/chat/completions` API — on your machine, in your home network, or at your
university/company.

> Prefer a cloud model? The sibling plugin **Euridian** connects to Infomaniak
> Euria ([repo](https://github.com/jlueschow/obsidian-euridian-plugin)). Both plugins
> share the same core.

## ⚠️ Vault agent — please read before enabling

The plugin can give the AI model **function-calling tools** that act on your vault:
list notes, read notes, search, create notes, append to notes, and **overwrite a
note's entire content**. This means the model can modify your files.

- **No delete tool exists at all** — not locked, simply not implemented.
- **Writes require confirmation by default** (setting *Bestätigung vor
  Schreibaktionen*): every create/append/overwrite shows a preview modal (with a
  word diff for overwrites) before anything touches disk. You can turn this off,
  but it's not recommended.
- **Overwriting a note replaces its entire content.** Anything the model doesn't
  repeat back is lost. The modal highlights this in red when content would shrink.
- The agent can be disabled entirely (*Vault-Agent* setting) if you only want
  plain chat.
- Note content you ask about is sent to **the server you configured**. With a server on your own machine nothing leaves it. See **Privacy** below.

## ✨ Features

- 💬 **Chat sidebar** with multiple tabs, persistent history, streaming responses;
  each chat keeps its own backend and model
- 🤖 **Vault agent** (function calling) — read, search, create, append and edit
  notes on request, with confirmation + diff preview before any write
- 📄 **Documents** — the agent can also read PDF, DOCX and PPTX files in your vault
- 🌐 **Optional web search** (Brave Search API), off by default
- 📎 **Attachments** — drag & drop files/images, attach vault notes or the current
  editor selection
- ⚡ **Slash commands** — reusable prompt templates (`/zusammenfassen`, `/übersetzen`, …)
  with placeholders `{{input}}`, `{{selection}}`, `{{note}}`, `{{title}}`
- 🔗 **@mention** — reference any vault note from the chat input
- ✏️ **Inline edit** — select text, edit it with AI, review a word diff, accept or reject
- 📝 **Custom instructions file** — a short markdown file in your vault with
  conventions for the agent (see below)

> **Language:** the plugin's interface is currently in German.

## 🤖 Using the vault agent

With **Vault-Agent** enabled (default) and a model that supports function calling,
just ask naturally:

> "Summarize the note 'Project X'"
> "Search my vault for notes about network routing"
> "Append today's meeting notes to my daily note"
> "What does the PDF in my attachments folder say about warranty terms?"

Each tool call appears as a chip in the chat. Extracted document text is capped
at 40k characters per file; scanned PDFs without a text layer return no text.
Not every model supports function calling reliably; very small models (≲1B
parameters) tend to hallucinate results instead of calling tools.

## 🌐 Web search (optional)

Adds a `search_web` tool via the [Brave Search API](https://brave.com/search/api/)
(free tier available). It is **off by default**, independent of the vault agent, and
always runs **locally through your own internet connection** — so it also works
when your model runs on a server without internet access. Enable it in Settings
→ *Websuche aktivieren* and paste your Brave API key.

## 📝 Custom instructions file

Point the plugin at a short markdown file (Settings → instructions file, default
`Agent.md` in the vault root) describing your vault's structure and conventions.
Keep it short and specific: large general-purpose instruction files written for
another assistant can overwhelm smaller models so that they stop calling tools.

## 🚀 Quick start

1. Run a server. For Ollama:
   ```bash
   brew install ollama
   ollama pull qwen3      # or any model with tool-calling support
   ollama serve
   ```
2. Enable the plugin under **Settings → Community plugins**, open its settings,
   and enter the **Server-URL** (default `http://localhost:11434`; for other
   servers e.g. `https://llm.example.org`, without a path). Add an **API-Key** only
   if your server requires one.
3. Click **Modelle scannen** to list the server's models (or type a model name),
   then **Testen** to verify the connection.
4. Open the chat: Command palette → `Vault Agent: Chat öffnen`, or use the ribbon icon.

If the server sits behind a VPN or internal network, connect before testing.

## 🔐 Privacy & network use

The plugin is desktop-only and sends requests **only to the servers you configure**:

| Service | Purpose | Data sent |
|---|---|---|
| Your server (Server-URL) | Chat requests, model list, optional Ollama model preload | Your messages, attached files/images, and any note content you ask about or the agent reads |
| `api.search.brave.com` (only if web search is enabled) | Web search | The search queries the model issues |

No telemetry, no other network calls. The optional API key is stored in plain text
in Obsidian's `data.json` (standard Obsidian behavior). **Server operators can
see everything you send** — for a server run by someone else (an institution,
a company), check their data-handling rules before sending sensitive content.

## 🔄 Coming from Euridian?

Until version 0.3, Euridian also offered Ollama and custom servers. To take your
settings and chats along, close Obsidian and copy
`.obsidian/plugins/euridian/data.json` to
`.obsidian/plugins/self-hosted-llm-vault-agent/data.json`; on first start the
plugin converts the Ollama/custom settings into the server settings.

## ⚠️ Known limitations

- Reasoning models can "think" for minutes; the *Thinking / Reasoning* toggle is
  off by default.
- Some servers cap the usable context well below the model's maximum; if requests
  fail with context-length errors, narrow the request or ask the operator.
- Servers or proxies that drop connections silently: the plugin aborts a stream
  after 90 s of complete silence and shows an error.

## 🔧 Development

```bash
git clone https://github.com/jlueschow/self-hosted-llm-vault-agent
cd self-hosted-llm-vault-agent
npm install
export EURIDIAN_PLUGIN_DIR="/path/to/YourVault/.obsidian/plugins/self-hosted-llm-vault-agent"
npm run dev      # watch, rebuild and deploy on every change
npm run build    # production build + deploy
```

`src/core` is a **copy** of the shared core from the Euridian repo — do not edit it
here. Update it with `node scripts/sync-core.mjs ../obsidian-euridian-plugin`; CI
checks for drift. `src/variant` holds what is specific to this plugin.

## 📄 License

MIT — see [LICENSE](LICENSE).
