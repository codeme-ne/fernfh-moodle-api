# fernfh-s2

MCP-Server, um FernFH-Studienmaterialien aus ZIP-Exporten lokal zu importieren, zu indexieren und in MCP-Clients wie `Codex` oder `Claude Code` durchsuchbar zu machen.

## Voraussetzungen

- Node.js 24+
- `unzip`
- `pdftotext`
- `tesseract`

## Setup

```bash
npm install
npm run build
```

## FernFH Moodle-DL Notes

Die FernFH-spezifische Vorgehensweise fuer `moodle-dl`, inklusive SSO-Token-Flow, API-Test, Vollkurs-Download, Grenzen und Sicherheits-Hinweisen, steht in [docs/fernfh-moodle-dl.md](docs/fernfh-moodle-dl.md).

Wichtig:

- Dieses Repo ist der lokale MCP-/Import-/Index-Server.
- `moodle-dl` ist ein getrennter Downloader, der fuer FernFH-Login und Materialabruf genutzt wird.
- `downloads/` ist eine lokale Materialablage, waehrend `data/` der eigentliche MCP-/Index-Datenbestand ist.

## Server starten

```bash
npm start
```

Der Server nutzt `stdio` und speichert Daten standardmaessig unter `./data`.

## MCP-Tools

- `import_course_zip`: ZIP-Datei importieren, entpacken und indexieren
- `list_courses`: bekannte Kurse auflisten
- `search_course`: Volltextsuche ueber einen oder alle Kurse
- `read_document`: extrahierten Text eines Dokuments lesen
- `watch_downloads`: Download-Ordner auf neue ZIP-Dateien beobachten
- `unwatch_downloads`: aktive Beobachtung beenden

## Umgebungsvariablen

- `FERNFH_S2_DATA_DIR`: alternatives Datenverzeichnis
- `FERNFH_S2_OCR_LANGS`: OCR-Sprachen, Standard `eng+deu`
- `FERNFH_S2_CHUNK_SIZE`: Zielgroesse pro Index-Chunk, Standard `1200`
- `FERNFH_S2_CHUNK_OVERLAP`: Ueberlappung zwischen Chunks, Standard `200`
- `FERNFH_S2_READ_LENGTH`: Standardlaenge fuer `read_document`, Standard `4000`

## Beispiel fuer Claude Code / Codex

Die genaue MCP-Konfiguration haengt vom Client ab. Der auszufuehrende Befehl ist in beiden Faellen derselbe:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/fernfh-s2/dist/index.js"]
}
```
