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

- [downloads/CIS604 - Datenvisualisierungs-Labor/LV-Konzept_ITMA_CIS604_SoSe2026_Jungbauer.pdf](/home/lukaszangerl/Dokumente/01%20Projects/fernfh-s2/downloads/CIS604%20-%20Datenvisualisierungs-Labor/LV-Konzept_ITMA_CIS604_SoSe2026_Jungbauer.pdf)

Verifikation:

```text
PDF
6 Seiten
Titel: ITMA LV-Konzept CIS604
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
