/* ============================================================
   MyWay – Bewegung auf der Karte

   Der Fahrer meldet seine Position etwa alle fünf Sekunden. Würde der
   Wagen bei jeder Meldung an die neue Stelle springen, sähe das kaputt aus.
   Hier wird zwischen zwei Meldungen gleichmäßig überblendet und der Wagen
   in Fahrtrichtung gedreht.
   ============================================================ */

/** Kurswinkel von a nach b in Grad, 0 = Norden. */
export function kurs(a, b) {
  const bogen = g => g * Math.PI / 180;
  const dLon = bogen(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(bogen(b.lat));
  const x = Math.cos(bogen(a.lat)) * Math.sin(bogen(b.lat)) -
            Math.sin(bogen(a.lat)) * Math.cos(bogen(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const SPARSAM = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Führt einen Leaflet-Marker weich von seiner jetzigen Position zur neuen.
 * Gibt eine Funktion zurück, die eine laufende Bewegung abbricht – ohne die
 * würden sich zwei Meldungen kurz hintereinander gegenseitig überfahren.
 */
export function bewegeMarker(marker, ziel, dauer = 4000) {
  const von = marker.getLatLng();
  const nach = { lat: ziel.lat, lng: ziel.lon };

  if (SPARSAM.matches || dauer <= 0) {
    marker.setLatLng(nach);
    return () => {};
  }

  let abgebrochen = false;
  const start = performance.now();

  // Sanft anlaufen und auslaufen; linear wirkt mechanisch
  const weich = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  (function schritt(jetzt) {
    if (abgebrochen) return;
    const anteil = Math.min((jetzt - start) / dauer, 1);
    const p = weich(anteil);
    marker.setLatLng({
      lat: von.lat + (nach.lat - von.lat) * p,
      lng: von.lng + (nach.lng - von.lng) * p
    });
    if (anteil < 1) requestAnimationFrame(schritt);
  })(start);

  return () => { abgebrochen = true; };
}
