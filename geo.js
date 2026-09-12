/* ============================================================
   MyWay – Entfernungen

   Nur für die Frage „wie weit ist der Fahrgast weg?". Bewusst Luftlinie
   statt Routendienst: die Fahrerliste kann ein Dutzend Anfragen enthalten,
   und für jede eine OSRM-Abfrage zu starten wäre langsam und unhöflich
   gegenüber einem kostenlosen Dienst. Für die Entscheidung „nehme ich die
   Fahrt?" reicht die Größenordnung – deshalb steht in der Oberfläche
   auch „ca." davor.
   ============================================================ */

const ERDRADIUS_KM = 6371;

/** Luftlinie zwischen zwei Punkten in Kilometern (Haversine). */
export function entfernung(a, b) {
  const bogen = g => g * Math.PI / 180;
  const dLat = bogen(b.lat - a.lat);
  const dLon = bogen(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(bogen(a.lat)) * Math.cos(bogen(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * ERDRADIUS_KM * Math.asin(Math.sqrt(h));
}

/* Wiener Innenstadt-Schnitt inklusive Ampeln und Einbahnen. Lieber etwas
   pessimistisch schätzen: ein Fahrer, der früher da ist als angesagt,
   ärgert sich nicht. */
const STADT_KMH = 22;
/* Luftlinie mal Umwegfaktor – Straßen laufen nun mal nicht schnurgerade. */
const UMWEG = 1.35;

/** Grobe Anfahrtszeit in Minuten aus der Luftlinie. */
export function fahrzeitMinuten(luftlinieKm) {
  return Math.max(1, Math.round(luftlinieKm * UMWEG / STADT_KMH * 60));
}
