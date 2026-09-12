/* ============================================================
   MyWay – Datenschicht (Supabase)

   Fahrgast- und Fahrer-Ansicht sprechen AUSSCHLIESSLICH mit dieser Datei.
   Niemals direkt auf die Datenbank zugreifen.

   IDENTITÄT: Jedes Gerät meldet sich beim Start anonym an und bekommt damit
   eine eigene Nutzer-ID. Darauf bauen die Zugriffsregeln in Postgres auf:
   Ein Fahrgast sieht nur seine eigene Fahrt, ein Fahrer nur offene Anfragen
   und die ihm zugeteilten. Lesen geht direkt über die Tabelle, jede Änderung
   läuft über geprüfte Datenbank-Funktionen – der Client kann seine Rolle
   nicht behaupten, die Datenbank stellt sie fest.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { SUPABASE_URL, SUPABASE_KEY } from './konfig.js';

const TABELLE = 'auftraege';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

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

/* ---------- Anmeldung ----------
   Anonym heißt: kein Name, keine Mailadresse, kein Passwort – aber eine
   stabile ID, an der die Zugriffsregeln festmachen können. Ohne die wäre
   „meine Fahrt" von „irgendeiner Fahrt" nicht unterscheidbar.            */
export const bereit = (async function anmelden() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      console.error('Anmeldung:', error);
      throw new Error('Keine Verbindung zum Dienst. Bitte später erneut versuchen.');
    }
  }
  // Realtime braucht das Token separat, sonst liefert es unter scharfen
  // Zugriffsregeln stillschweigend nichts mehr.
  const { data: { session: s } } = await db.auth.getSession();
  db.realtime.setAuth(s.access_token);
  return s.user.id;
})();

/* ---------- Fehler verständlich machen ----------
   Die Ansichten zeigen die Meldung wörtlich an. Postgres-Jargon hat dort
   nichts verloren, ein fehlendes Netz ist der häufigste Fall.              */
function fehlerWerfen(fehler, ersatz) {
  if (!navigator.onLine) throw new Error('Keine Verbindung. Bitte Netz prüfen.');
  console.error('Datenbank:', fehler);
  throw new Error(ersatz);
}

/* ---------- Fahrer ---------- */

/**
 * Zugangscode einlösen. Der Code wird in der Datenbank gegen einen Hash
 * geprüft – die Fahrerliste stand früher im JavaScript und war damit für
 * jeden lesbar, der die Seite öffnet.
 */
export async function fahrerAnmelden(code) {
  await bereit;
  const { data, error } = await db.rpc('fahrer_beanspruchen', {
    p_code: String(code || '').trim().toUpperCase()
  });
  if (error) {
    if (error.message?.includes('nicht bekannt')) return null;
    fehlerWerfen(error, 'Anmeldung nicht möglich.');
  }
  return data;
}

/** Ist dieses Gerät schon an einen Fahrer gebunden? Ersetzt das frühere
    Merken der Fahrer-ID im localStorage: die Bindung steht jetzt in der
    Datenbank und gilt genau für dieses angemeldete Gerät. */
export async function meinFahrer() {
  await bereit;
  const { data, error } = await db.from('fahrer')
    .select('id,name,kennzeichen,modell,telefon').maybeSingle();
  if (error) return null;
  return data;
}

/* ---------- Live-Aktualisierung ----------
   Ein Abo für die ganze Tabelle. Was davon ankommt, entscheiden die
   Zugriffsregeln – jedes Gerät bekommt nur Meldungen zu Zeilen, die es auch
   lesen darf.                                                              */
const rueckrufe = new Set();

bereit.then(() => {
  db.channel('auftraege-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABELLE },
        () => rueckrufe.forEach(f => f()))
    .subscribe();
}).catch(() => { /* ohne Anmeldung gibt es nichts zu abonnieren */ });

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
  const meineId = await bereit;
  const { data, error } = await db.from(TABELLE).insert({
    id: neueNummer(),
    status: 'offen',
    fahrgast_id: meineId,
    start: daten.start,
    ziel: daten.ziel,
    km: daten.km,
    minuten: daten.minuten,
    preis: daten.preis,
    nacht: daten.nacht,
    zahlart_wunsch: daten.zahlartWunsch ?? null,
    verlauf: [{ status: 'offen', zeit: new Date().toISOString() }]
  }).select().single();

  if (error) fehlerWerfen(error, 'Anfrage konnte nicht gesendet werden.');
  return data;
}

export async function auftragLesen(id) {
  await bereit;
  const { data, error } = await db.from(TABELLE).select().eq('id', id).maybeSingle();
  if (error) fehlerWerfen(error, 'Fahrt konnte nicht geladen werden.');
  return data;
}

/** Fahrer: alle noch nicht vergebenen Aufträge.
    Wer am längsten wartet, steht oben – sonst bleibt der erste Fahrgast liegen,
    während neuere Anfragen laufend nach vorne rutschen. */
export async function offeneAuftraege() {
  await bereit;
  const { data, error } = await db.from(TABELLE)
    .select().eq('status', 'offen').order('erstellt', { ascending: true });
  if (error) fehlerWerfen(error, 'Aufträge konnten nicht geladen werden.');
  return data || [];
}

/** Fahrer: die Fahrt, an der dieser Fahrer gerade dran ist (falls vorhanden). */
export async function laufendeFahrt(fahrerId) {
  await bereit;
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
  await bereit;
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
 * Wer der Fahrer ist, stellt die Datenbank selbst fest – deshalb braucht es
 * hier keine Fahrerdaten mehr als Argument.
 */
export async function auftragAnnehmen(id) {
  await bereit;
  const { data, error } = await db.rpc('auftrag_annehmen', { p_id: id });
  if (error) {
    if (error.message?.includes('übernommen')) throw new Error('Diese Fahrt hat schon jemand übernommen.');
    fehlerWerfen(error, 'Fahrt konnte nicht übernommen werden.');
  }
  return data;
}

/** Zustand weiterschalten. Der zugeteilte Fahrer darf alles, der Fahrgast
    darf seine eigene Fahrt stornieren. */
export async function statusSetzen(id, status, zusatz = {}) {
  await bereit;
  if (!ZUSTAND[status]) throw new Error('Unbekannter Zustand: ' + status);

  const { data, error } = await db.rpc('status_setzen', {
    p_id: id, p_status: status, p_zahlart: zusatz.zahlart ?? null
  });
  if (error) {
    if (error.message?.includes('gehört dir nicht')) throw new Error('Diese Fahrt gehört dir nicht.');
    fehlerWerfen(error, 'Zustand konnte nicht gespeichert werden.');
  }
  if (!data) throw new Error('Diese Fahrt gibt es nicht mehr.');
  return data;
}

/** Fahrer: aktuelle Position melden. Fehler werden geschluckt – eine
    verpasste Position ist kein Grund, dem Fahrer etwas anzuzeigen. */
export async function positionSenden(id, lat, lon) {
  try {
    await bereit;
    await db.rpc('position_senden', { p_id: id, p_lat: lat, p_lon: lon });
  } catch (e) {
    console.warn('Position nicht gesendet:', e);
  }
}

/** Fahrgast: Fahrt bewerten (1–5), nur nach der eigenen beendeten Fahrt. */
export async function bewerten(id, note) {
  await bereit;
  const { error } = await db.rpc('bewerten', { p_id: id, p_note: note });
  if (error) fehlerWerfen(error, 'Bewertung konnte nicht gespeichert werden.');
}

/** Geteilter Link: abgespeckte Sicht ohne Preis und ohne Zieladresse.
    Braucht keine Anmeldung – das Geheimnis aus dem Link ist der Nachweis. */
export async function fahrtVerfolgen(id, geheimnis) {
  const { data, error } = await db.rpc('fahrt_verfolgen', {
    p_id: id, p_geheimnis: geheimnis
  });
  if (error) fehlerWerfen(error, 'Diese Fahrt ist nicht abrufbar.');
  return data;
}
