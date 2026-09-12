# MyWay

Fahrtenvermittlung für Wien. Web-App (PWA), läuft im Browser.

## Kosten
Domain ~15 €/Jahr. Alles andere Gratis-Stufen:
Vercel (Hosting), Supabase (Datenbank), OpenStreetMap (Karte),
Photon (Adresssuche), OSRM (Route), Stripe (nur % pro Zahlung).

## Live
https://mn777hub.github.io/myway/ — Fahrgast
https://mn777hub.github.io/myway/fahrer.html — Fahrer

## Datenbank
Supabase-Projekt „MyWay" (eu-central-1). Tabelle `auftraege`, Live-Updates
über Supabase Realtime. Zugangsdaten stehen in `app/konfig.js` – der
publishable Key darf öffentlich sein, der service_role-Key nie.

Fahrgast und Fahrer können auf getrennten Geräten sein.

Jedes Gerät meldet sich anonym an und bekommt eine eigene Nutzer-ID. Darauf
bauen die Zugriffsregeln auf: Ein Fahrgast sieht nur die eigene Fahrt, ein
Fahrer nur offene Anfragen und die ihm zugeteilten. Lesen läuft über die
Tabelle, jede Änderung über geprüfte Datenbank-Funktionen.

Voraussetzung im Supabase-Projekt: Authentication → Sign In / Providers →
"Allow anonymous sign-ins" muss eingeschaltet sein.

Fahrer-Zugangscodes stehen gehasht in der Tabelle `fahrer`, nicht im
JavaScript.

## Struktur
- `app/` – die Web-App
- `assets/` – Logo, Bilder
- `docs/` – Notizen

## Veröffentlichen
    ./deploy.sh

## Lokal starten
    python3 -m http.server 8080 --directory app
    → http://localhost:8080
