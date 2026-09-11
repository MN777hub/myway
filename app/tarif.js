/* ============================================================
   Wiener Taxitarif – amtliche Berechnung
   Grundlage: Verordnung des Landeshauptmannes von Wien
   Stand: geprüft 09/2026

   WICHTIG: In Wien ist dieser Tarif gesetzlich verbindlich.
   MyWay darf ihn weder unter- noch überschreiten.
   Der Vorteil für Fahrer entsteht über die Provision, nicht über den Preis.
   ============================================================ */

export const TARIF = {
  tag: {
    grund: 3.80,
    km_1_4: 1.42,   // erste 4 km
    km_5_9: 1.08,   // km 5 bis 9
    km_ab10: 1.05,  // ab km 10
    von: 6, bis: 23
  },
  nacht: {
    grund: 4.30,
    km_1_4: 1.62,
    km_5_9: 1.28,
    km_ab10: 1.18
  },
  // Zuschläge
  funkzuschlag: 2.80,   // bei telefonischer/App-Bestellung zulässig
  wartezeit_min: 0.42,  // je angefangene Minute Wartezeit
  mindest: 0            // kein gesetzlicher Mindestpreis
};

/** Ist der Zeitpunkt im Nachttarif? (23:00–06:00) */
export function istNacht(datum = new Date()) {
  const h = datum.getHours();
  return h >= TARIF.tag.bis || h < TARIF.tag.von;
}

/**
 * Berechnet den Fahrpreis nach Wiener Tarif.
 * @param {number} km        Strecke in Kilometern
 * @param {object} optionen  { nacht, funk, wartezeitMin }
 */
export function berechneFahrpreis(km, optionen = {}) {
  const {
    nacht = istNacht(),
    funk = true,          // App-Bestellung gilt als Funkbestellung
    wartezeitMin = 0
  } = optionen;

  const t = nacht ? TARIF.nacht : TARIF.tag;
  let preis = t.grund;

  // Staffelung der Kilometer
  const bis4 = Math.min(km, 4);
  const bis9 = km > 4 ? Math.min(km - 4, 5) : 0;
  const ab10 = km > 9 ? km - 9 : 0;

  preis += bis4 * t.km_1_4;
  preis += bis9 * t.km_5_9;
  preis += ab10 * t.km_ab10;

  if (funk) preis += TARIF.funkzuschlag;
  if (wartezeitMin > 0) preis += wartezeitMin * TARIF.wartezeit_min;

  return {
    gesamt: runde(preis),
    nacht,
    aufschluesselung: {
      grundbetrag: t.grund,
      strecke: runde(bis4 * t.km_1_4 + bis9 * t.km_5_9 + ab10 * t.km_ab10),
      funkzuschlag: funk ? TARIF.funkzuschlag : 0,
      wartezeit: runde(wartezeitMin * TARIF.wartezeit_min)
    }
  };
}

/**
 * Was bleibt dem Fahrer, was bekommt MyWay?
 * @param {number} fahrpreis
 * @param {string} modell  'provision' | 'abo'
 */
export function aufteilung(fahrpreis, modell = 'provision') {
  const SATZ = 0.12; // 12 % – Uber nimmt 25-35 %
  if (modell === 'abo') {
    return { fahrer: runde(fahrpreis), myway: 0, hinweis: 'Abo: 0 % Provision' };
  }
  const myway = runde(fahrpreis * SATZ);
  return {
    fahrer: runde(fahrpreis - myway),
    myway,
    hinweis: `${SATZ * 100} % Provision`
  };
}

/** Vergleich: Was bliebe bei den Mitbewerbern? */
export function vergleich(fahrpreis) {
  return [
    { name: 'MyWay',   prozent: 12, fahrer: runde(fahrpreis * 0.88) },
    { name: 'FreeNow', prozent: 18, fahrer: runde(fahrpreis * 0.82) },
    { name: 'Bolt',    prozent: 27, fahrer: runde(fahrpreis * 0.73) },
    { name: 'Uber',    prozent: 28, fahrer: runde(fahrpreis * 0.72) }
  ];
}

function runde(n) {
  return Math.round(n * 100) / 100;
}

export function formatEuro(n) {
  return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}
