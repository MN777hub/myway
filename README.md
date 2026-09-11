# MyWay

Fahrtenvermittlung für Wien. Web-App (PWA), läuft im Browser.

## Kosten
Domain ~15 €/Jahr. Alles andere Gratis-Stufen:
Vercel (Hosting), Supabase (Datenbank), OpenStreetMap (Karte),
Photon (Adresssuche), OSRM (Route), Stripe (nur % pro Zahlung).

## Datenbank
Supabase-Projekt „MyWay" (eu-central-1). Tabelle `auftraege`, Live-Updates
über Supabase Realtime. Zugangsdaten stehen in `app/konfig.js` – der
publishable Key darf öffentlich sein, der service_role-Key nie.

Fahrgast und Fahrer können auf getrennten Geräten sein. Zugriffsregeln (RLS)
sind für die Demo bewusst offen; vor echten Fahrten kommt Supabase-Auth.

## Struktur
- `app/` – die Web-App
- `assets/` – Logo, Bilder
- `docs/` – Notizen

## Lokal starten
    python3 -m http.server 8080 --directory app
    → http://localhost:8080
