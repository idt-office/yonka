# Modell-Ergebnisse

Jeder Ordner enthaelt die Ergebnisse eines Modells. GitHub Pages liefert
das Repo-Root, d. h. jedes Ergebnis liegt unter
`https://idt-office.github.io/yonka/<ordner>/`.

Aktuell:

- [`qwen-3-8-int4/`](qwen-3-8-int4/) - Yonkers Prime, Three.js-Stomp-Tour
  &#252;ber Manhattan/Brooklyn/Queens mit OSM-Daten (siehe dort README)

## Neues Modell

Ordner neu anlegen (z. B. `claude-sonnet-4/`), Inhalte dort ablegen,
Commit + Push - der Ordner ist auf Pages sofort erreichbar. Landing-Seite
(`index.html` um eine Karte ergaenzen).

Lokaler Test-Server fuer ein Ergebnis (ES-Module brauchen HTTP, nicht
`file://`): `cd <ordner> && python3 -m http.server 8765`.
