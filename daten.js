/* ============================================================
   MyWay – Datenschicht (Supabase)

   Fahrgast- und Fahrer-Ansicht sprechen AUSSCHLIESSLICH mit dieser Datei.
   Niemals direkt auf die Datenbank zugreifen.

   Fahrgast und Fahrer sitzen jetzt auf verschiedenen Geräten: die Aufträge
   liegen in Postgres, Änderungen kommen über Supabase Realtime zurück.

   NOCH OFFEN FÜR DEN ECHTBETRIEB:
   Die Zugriffsregeln (RLS) sind für die Demo bewusst offen – wer den Key hat,
   sieht alle Aufträge. Vor echten Fahrten kommt Supabase-Auth: Fahrgast sieht
   nur die eigene Fahrt, Fahrer nur offene und eigene.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { SUPABASE_URL, SUPABASE_KEY } from './konfig.js';

const TABELLE = 'auftraege';
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

/* ---------- Zustände einer Fahrt ---------- */
export const ZUSTAND = {
  offen:         { text: 'Suche Fahrer',      fahrgast: 'Wir suchen einen Fahrer für Sie.' },
  angenommen:    { text: 'Angenommen',        fahrgast: 'Ein Fahrer hat Ihre Fahrt übernommen.' },
  unterwegs:     { text: 'Auf dem Weg',       fahrgast: 'Ihr Fahrer ist auf dem Weg zu Ihnen.' },
  beim_fahrgast: { text: 'Vor Ort',           fahrgast: 'Ihr Fahrer wartet vor Ort.' },
  laeuft:        { text: 'Fahrt läuft',       fahrgast: 'Gute Fahrt.' },
  beendet:       { text: 'Beendet',           fahrgast: 'Fahrt beendet. Danke, dass Sie MyWay genutzt haben.' },
  storniert:     { text: 'Storniert',         fahrgast: 'Die Fahrt wurde storniert.' }
};

/** Reihenfolge, die der Fahrer durchläuft */
export const ABLAUF = ['angenommen', 'unterwegs', 'beim_fahrgast', 'laeuft', 'beendet'];

/* ---------- Zugelassene Fahrer ----------
   DEMO-ZUGANG: Das ist eine Tür, kein Schloss. Wer den Code kennt, kommt rein.
   Echte Absicherung kommt mit Supabase-Auth, sobald echte Fahrer fahren.
   Marcel vergibt diese Codes persönlich nach Prüfung des Taxischeins.        */
export const FAHRER = [
  { id: 'WIEN-1042', name: 'Michael',  kennzeichen: 'W-12345 TX', modell: 'Škoda Octavia' },
  { id: 'WIEN-1043', name: 'Aleksandr', kennzeichen: 'W-88210 TX', modell: 'Toyota Prius' },
  { id: 'WIEN-1044', name: 'Fatima',   kennzeichen: 'W-45907 TX', modell: 'VW Touran' }
];

export function fahrerPruefen(code) {
  const sauber = String(code || '').trim().toUpperCase();
  return FAHRER.find(f => f.id === sauber) || null;
}

/* ---------- Fehler verständlich machen ----------
   Die Ansichten zeigen die Meldung wörtlich an. Postgres-Jargon hat dort
   nichts verloren, ein fehlendes Netz ist der häufigste Fall.              */
function fehlerWerfen(fehler, ersatz) {
  if (!navigator.onLine) throw new Error('Keine Verbindung. Bitte Netz prüfen.');
  console.error('Datenbank:', fehler);
  throw new Error(ersatz);
}

/* ---------- Live-Aktualisierung ----------
   Ein einziges Abo für die ganze Tabelle. Jede Änderung stößt alle
   angemeldeten Ansichten an, die dann selbst neu laden.                     */
const rueckrufe = new Set();

db.channel('auftraege-live')
  .on('postgres_changes', { event: '*', schema: 'public', table: TABELLE },
      () => rueckrufe.forEach(f => f()))
  .subscribe();

// Nach Bildschirmsperre oder Tunnel kann das Abo Lücken haben – beim
// Zurückkommen einmal frisch laden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') rueckrufe.forEach(f => f());
});

/** Meldet sich, sobald sich irgendein Auftrag ändert. Gibt eine Abmeldefunktion zurück. */
export function beiAenderung(rueckruf) {
  rueckrufe.add(rueckruf);
  return () => rueckrufe.delete(rueckruf);
}

/* ---------- Aufträge ---------- */

/** Kurze, gut vorlesbare Nummer. Der Zufallsteil verhindert Dubletten,
    wenn zwei Fahrgäste in derselben Millisekunde buchen. */
function neueNummer() {
  const zeit = Date.now().toString(36).toUpperCase();
  const zufall = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `MW-${zeit}${zufall}`;
}

/** Fahrgast: neuen Auftrag anlegen. Gibt den gespeicherten Auftrag zurück. */
export async function auftragAnlegen(daten) {
  const { data, error } = await db.from(TABELLE).insert({
    id: neueNummer(),
    status: 'offen',
    start: daten.start,
    ziel: daten.ziel,
    km: daten.km,
    minuten: daten.minuten,
    preis: daten.preis,
    nacht: daten.nacht,
    verlauf: [{ status: 'offen', zeit: new Date().toISOString() }]
  }).select().single();

  if (error) fehlerWerfen(error, 'Anfrage konnte nicht gesendet werden.');
  return data;
}

export async function auftragLesen(id) {
  const { data, error } = await db.from(TABELLE).select().eq('id', id).maybeSingle();
  if (error) fehlerWerfen(error, 'Fahrt konnte nicht geladen werden.');
  return data;
}

/** Fahrer: alle noch nicht vergebenen Aufträge.
    Wer am längsten wartet, steht oben – sonst bleibt der erste Fahrgast liegen,
    während neuere Anfragen laufend nach vorne rutschen. */
export async function offeneAuftraege() {
  const { data, error } = await db.from(TABELLE)
    .select().eq('status', 'offen').order('erstellt', { ascending: true });
  if (error) fehlerWerfen(error, 'Aufträge konnten nicht geladen werden.');
  return data || [];
}

/** Fahrer: die Fahrt, an der dieser Fahrer gerade dran ist (falls vorhanden). */
export async function laufendeFahrt(fahrerId) {
  const { data, error } = await db.from(TABELLE)
    .select()
    .eq('fahrer_id', fahrerId)
    .not('status', 'in', '(beendet,storniert)')
    .order('erstellt', { ascending: false })
    .limit(1);
  if (error) fehlerWerfen(error, 'Laufende Fahrt konnte nicht geladen werden.');
  return data?.[0] || null;
}

/** Fahrer: abgeschlossene Fahrten dieses Fahrers von heute.
    Gefiltert wird ab Mitternacht Ortszeit – der Fahrer denkt in seinem Tag,
    nicht in UTC. */
export async function fahrtenHeute(fahrerId) {
  const mitternacht = new Date();
  mitternacht.setHours(0, 0, 0, 0);

  const { data, error } = await db.from(TABELLE)
    .select()
    .eq('fahrer_id', fahrerId)
    .eq('status', 'beendet')
    .gte('erstellt', mitternacht.toISOString());
  if (error) fehlerWerfen(error, 'Verdienst konnte nicht geladen werden.');
  return data || [];
}

/**
 * Fahrer: Auftrag annehmen. Erster gewinnt.
 * Das Rennen entscheidet die Datenbank (siehe Funktion auftrag_annehmen):
 * der zweite Fahrer bekommt eine Absage statt derselben Fahrt.
 */
export async function auftragAnnehmen(id, fahrer) {
  const { data, error } = await db.rpc('auftrag_annehmen', {
    p_id: id,
    p_fahrer: {
      id: fahrer.id, name: fahrer.name,
      kennzeichen: fahrer.kennzeichen, modell: fahrer.modell
    }
  });

  // Absage der Funktion wörtlich durchreichen – sie ist für den Fahrer gedacht
  if (error) {
    if (error.message?.includes('übernommen')) throw new Error('Diese Fahrt hat schon jemand übernommen.');
    fehlerWerfen(error, 'Fahrt konnte nicht übernommen werden.');
  }
  return data;
}

/** Fahrer: Zustand weiterschalten. Verlauf wird in der Datenbank ergänzt. */
export async function statusSetzen(id, status, zusatz = {}) {
  if (!ZUSTAND[status]) throw new Error('Unbekannter Zustand: ' + status);

  const { data, error } = await db.rpc('status_setzen', {
    p_id: id,
    p_status: status,
    p_zahlart: zusatz.zahlart ?? null
  });

  if (error) fehlerWerfen(error, 'Zustand konnte nicht gespeichert werden.');
  if (!data) throw new Error('Diese Fahrt gibt es nicht mehr.');
  return data;
}

/** Nur für Tests und Aufräumen. */
export async function allesLoeschen() {
  const { error } = await db.from(TABELLE).delete().neq('id', '');
  if (error) fehlerWerfen(error, 'Aufräumen fehlgeschlagen.');
}
