# FernFH Moodle-DL Notes

Stand: 2026-03-16

## Fast Path

```text
FernFH + Microsoft SSO
        |
        v
Browser-Login
        |
        v
/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodledl
        |
        v
302 Location: moodledl://token=BASE64
        |
        v
moodle-dl --init --sso
        |
        v
config.json mit token + privatetoken
```

## Wichtigste Erkenntnisse

- Fuer FernFH ist `--init --sso` der richtige erste Weg. Der normale Username/Password-Flow ist riskanter und kann in Rate Limits laufen.
- `sesskey` ist fuer `moodle-dl` nicht brauchbar. Er gehoert zur Web-Session und laeuft schnell ab.
- Der entscheidende Wert ist der komplette `Location`-Header:
  `moodledl://token=...`
- In der aktuellen lokalen Version `moodle-dl 2.3.13` ist `--init --token ...` kaputt. Verwende stattdessen `--init --sso`.
- `config.json` enthaelt echte Zugangsdaten und darf nicht committed werden.

## Was Die Tokens Bedeuten

```text
sesskey
  = kurzer Web-Session/Form-Schutz
  = nicht fuer moodle-dl

token
  = API-Zugriff fuer /webservice/rest/server.php
  = damit holt moodle-dl Kurse, Module und Dateien

privatetoken
  = Zusatz fuer Cookie-/Autologin-Hilfe
  = nuetzlich fuer Inhalte, die Browser-Cookies brauchen
```

## SSO-Vorgehensweise

1. Im Browser normal bei `https://onlinecampus.fernfh.ac.at` anmelden.
2. DevTools oeffnen, `Network` aktivieren, `Preserve log` einschalten.
3. Diese URL in derselben eingeloggten Session aufrufen:
   `https://onlinecampus.fernfh.ac.at/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodledl`
4. Den `302`-Request oeffnen.
5. Den kompletten `Location`-Header kopieren:
   `moodledl://token=...`
6. Lokal initialisieren:

```bash
.venv/bin/moodle-dl --init --sso
```

7. Zusatzfragen mit `N` beantworten.
8. Als Moodle-URL eingeben:

```text
https://onlinecampus.fernfh.ac.at
```

9. Danach den kompletten `moodledl://token=...`-Wert einfuegen.

## Lokaler Stand Aus Dieser Session

- `.venv` wurde lokal erstellt.
- `moodle-dl 2.3.13` ist installiert.
- `config.json` enthaelt:

```text
moodle_domain
moodle_path
token
privatetoken
```

- Erfolgreich ueber API verifiziert:
  `core_webservice_get_site_info`
- Erfolgreich ueber API verifiziert:
  `core_enrol_get_users_courses`
- Die Session am 2026-03-16 sah `103` Kurse.

## Wie moodle-dl Danach Arbeitet

```text
config.json
  |
  +-- token --------> Moodle REST API
  |                   /webservice/rest/server.php?wsfunction=...
  |
  +-- privatetoken --> autologin key --> cookies fuer Spezialfaelle
```

```text
token
  -> Kursliste
  -> Kursstruktur
  -> Core Contents
  -> Modul-spezifische Handler
  -> Dateilinks
  -> Download
```

Unterstuetzte Handler im Paket:

- `assign`
- `book`
- `calendar`
- `data`
- `folder`
- `forum`
- `lesson`
- `page`
- `quiz`
- `workshop`

## FernFH-Spezialfall

```text
Browser Download Center
        !=
Moodle Mobile / Webservice API
```

- `moodle-dl` nutzt primaer die Moodle-API, nicht das FernFH-`Download Center`-Plugin.
- Das ist gut fuer Standard-Dateien, PDFs, Aufgaben, Foren, Ordner, Buecher und aehnliche Inhalte.
- Wenn ein FernFH-spezifisches Plugin seine Inhalte nicht ueber die API liefert, kann ein Browser-Fallback noetig sein.

## Bereits Erfolgreich Getestet

Kurs:

- `5517`
- `CIS604 - Datenvisualisierungs-Labor`

Ueber die API sichtbar:

- `LV-Konzept CIS604 - Datenvisualisierungs-Labor`
- `So luegt man mit Statistik`
- `ESA1.pdf`
- `ESA2.pdf`
- `ESA3.pdf`
- `ESA4.pdf`
- `Tableau Buch`
- `Gestaltung wissenschaftlicher Poster`
- `ScientificPosters.pdf`

Erfolgreich direkt ueber API-Dateilink heruntergeladen:

- `downloads/CIS604 - Datenvisualisierungs-Labor/LV-Konzept_ITMA_CIS604_SoSe2026_Jungbauer.pdf`

Verifikation:

```text
PDF
6 Seiten
Titel: ITMA LV-Konzept CIS604
```

## Vollkurs-Download Mit moodle-dl

Erfolgreich getestet wurde auch ein kompletter `moodle-dl`-Lauf fuer:

- `5517`
- `CIS604 - Datenvisualisierungs-Labor`

Vorgehen:

1. Die echte `config.json` nicht direkt fuer Kursfilter aendern.
2. Stattdessen einen Temp-Ordner erzeugen und die echte `config.json` dorthin kopieren.
3. Wichtig: `moodle-dl -p <ordner>` liest **nur** `<ordner>/config.json`.
   Der Temp-Ordner wird **nicht** mit der echten Konfiguration gemerged.
4. Deshalb muss die temporaere `config.json` die vorhandenen Pflichtfelder behalten,
   mindestens:

```json
{
  "moodle_domain": "onlinecampus.fernfh.ac.at",
  "moodle_path": "/",
  "token": "...",
  "privatetoken": "..."
}
```

5. In dieser kopierten JSON-Datei nur die Download-Optionen zusaetzlich setzen oder ueberschreiben, z. B.:

```json
{
  "download_course_ids": [5517],
  "download_descriptions": true,
  "download_forums": true,
  "download_books": true,
  "download_lessons": true,
  "download_workshops": true,
  "download_quizzes": true,
  "download_also_with_cookie": true,
  "download_path": "/absoluter/lokaler/zielordner"
}
```

6. Beispielablauf:

```bash
tmpdir="$(mktemp -d)"
cp config.json "$tmpdir/config.json"
# Danach in $tmpdir/config.json die zusaetzlichen JSON-Felder setzen.
.venv/bin/moodle-dl -p "$tmpdir"
```

7. Danach den Lauf mit dem temporaeren Profil starten:

```bash
.venv/bin/moodle-dl -p /tmp/<temp-config-dir>
```

Ergebnis in dieser Session:

- `35` Dateien/Markdown-Dateien
- ca. `41 MiB`
- Zielordner:
  `downloads/moodle-dl/CIS604 - Datenvisualisierungs-Labor`

Mitgenommen wurden u. a.:

- `ESA1.pdf`
- `ESA2.pdf`
- `ESA3.pdf`
- `ESA4.pdf`
- `LV-Konzept_ITMA_CIS604_SoSe2026_Jungbauer.pdf`
- `tableau-for-dummies-2nd-edition.pdf`
- `ScientificPosters.pdf`
- Foren und Beschreibungen als `.md`

Bekannter Schoenheitsfehler:

- Der `LV-Konzept`-Unterordner bekam einen HTML-artigen Namen.
- Der Inhalt wurde trotzdem korrekt heruntergeladen.

## Warum Nach downloads/?

`moodle-dl` wurde in dieser Session absichtlich nach `downloads/` umgeleitet, weil:

- der Zielordner lokal bleiben sollte
- die eigentliche `config.json` unveraendert bleiben sollte
- der Vollkurs-Download sauber von Repo-Code und MCP-Daten getrennt sein sollte
- `downloads/` bereits in `.gitignore` steht

Wichtig:

- Das ist **kein fest verdrahteter Pflichtpfad**.
- Naechstes Mal kann genauso gut ein anderer lokaler Ordner verwendet werden, z. B.:

```text
$HOME/FernFH/moodle-dl
```

- Fuer laengerfristige Ablage ist ein externer lokaler Datenordner meist besser als `repo/downloads/`.
- Das aktuelle MCP/RAG-Projekt importiert primaer ZIPs. Der `downloads/`-Ordner ist also Materialablage, nicht automatisch der kanonische RAG-Speicher.

## Session-Handoff 2026-03-16

Ziel dieser Session:

- FernFH-SSO fuer `moodle-dl` sauber und ohne weiteres Lockout zum Laufen bringen
- pruefen, was ueber die Moodle-API wirklich sichtbar ist
- einen kompletten Kurs testweise herunterladen
- das Repo fuer kuenftige Arbeit dokumentieren und absichern

Wichtige Entscheidungen:

- Dieses Repo ist **nicht** das Upstream-`moodle-dl`-Projekt.
- Dieses Repo ist ein eigener lokaler MCP-Server fuer Import, Extraktion, Index und Suche.
- `moodle-dl` ist hier nur der Downloader und Token-Client.
- `sesskey` wird fuer diesen Workflow nicht mehr verwendet.
- Fuer FernFH wird kuenftig immer zuerst `--init --sso` angenommen.

Was heute im Repo relevant gemacht oder geaendert wurde:

- [README.md](../README.md)
  enthaelt den Verweis auf diese FernFH-Doku.
- [.gitignore](../.gitignore)
  schliesst lokale Secrets und Laufzeitdateien aus, u. a. `config.json`, `.venv/`, `downloads/`.
- [AGENTS.md](../AGENTS.md)
  enthaelt Repo-Konventionen fuer kuenftige Mitarbeit.

Relevante Code-Dateien fuer den naechsten Einstieg:

- [src/server.ts](../src/server.ts)
  MCP-Tool-Registrierung
- [src/import-service.ts](../src/import-service.ts)
  Import von ZIPs in den lokalen Datenbestand
- [src/extractors.ts](../src/extractors.ts)
  Textextraktion aus PDF/HTML/Bildern
- [src/index-store.ts](../src/index-store.ts)
  Chunking und Suchindex
- [src/watcher-service.ts](../src/watcher-service.ts)
  Beobachtung eines Download-Ordners fuer neue ZIP-Dateien

Was lokal vorhanden sein sollte, bevor es weitergeht:

- `.venv` mit funktionierendem `moodle-dl`
- lokale `config.json` mit `token` und `privatetoken`
- ein bewusst gewaehlter lokaler Zielordner fuer Downloads
- optional ein externer Datenordner fuer spaeteren RAG-Bestand

Was beim naechsten Mal zuerst gelesen werden soll:

1. [README.md](../README.md)
2. diese Datei
3. die vier Kernstellen in `src/`

Was beim naechsten Mal zuerst getan werden soll:

1. Nicht neu einloggen, solange der vorhandene Token noch funktioniert.
2. Erst `config.json` lokal pruefen.
3. Danach nur einen read-only API-Test ausfuehren.
4. Erst dann Kurse listen.
5. Danach entweder einen kleinen Dateitest oder einen Vollkurs-Download mit temporaerer Konfiguration starten.

Offene Entscheidungen fuer die naechste Session:

- finalen lokalen Zielordner fuer laengerfristige Downloads festlegen
- entscheiden, ob `downloads/` nur Testablage bleibt oder durch einen externen lokalen Pfad ersetzt wird
- entscheiden, ob der Importpfad spaeter direkt aus `moodle-dl`-Downloads statt nur aus ZIPs unterstuetzt werden soll
- entscheiden, ob zusaetzlich zu `.txt` auch `.md` als kanonisches Zwischenformat gespeichert werden soll

Merksatz:

```text
moodle-dl  = Download + Moodle-API
fernfh-s2  = lokaler MCP + Extraktion + Suche
downloads/ = lokale Materialablage, nicht automatisch der RAG-Hauptspeicher
data/      = eigentlicher MCP-/Index-Datenbestand
```

## Nächstes Mal Zuerst Lesen

1. Diese Datei lesen.
2. Pruefen, ob `config.json` noch vorhanden ist.
3. Erst einen read-only API-Test machen.
4. Dann einen einzelnen Kurs oder eine einzelne Datei testen.
5. Erst danach groessere Downloads starten.

## Sichere Testbefehle

Kursliste:

```bash
python3 - <<'PY'
import json, urllib.request, urllib.parse
from pathlib import Path
cfg = json.loads(Path('config.json').read_text())
base = f"https://{cfg['moodle_domain']}{cfg.get('moodle_path', '/')}"
token = cfg['token']

def call(wsfunction, **params):
    data = {
        'wstoken': token,
        'moodlewsrestformat': 'json',
        'wsfunction': wsfunction,
        **params,
    }
    req = urllib.request.Request(
        base.rstrip('/') + '/webservice/rest/server.php',
        data=urllib.parse.urlencode(data).encode(),
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        print(r.read().decode())

call('core_webservice_get_site_info')
PY
```

Einzelnen Testdownload zuerst klein halten.
