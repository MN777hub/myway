/* ============================================================
   MyWay – Fahrgast-Ansicht
   Alle Dienste kostenlos, ohne Registrierung:
     Karte    OpenStreetMap
     Adressen Photon (Komoot)
     Route    OSRM
   ============================================================ */

import { berechneFahrpreis, formatEuro, istNacht } from './tarif.js';
import { auftragAnlegen, auftragLesen, statusSetzen, beiAenderung, ZUSTAND } from './daten.js';

const WIEN = [48.2082, 16.3738];

const zustand = {
  start: null,   // { name, ort, lat, lon }
  ziel: null,
  route: null,   // { km, minuten, linie }
  aktivesFeld: null,
  auftragId: null
};

/* ---------- Karte ---------- */
const karte = L.map('karte', {
  center: WIEN, zoom: 13, zoomControl: false, attributionControl: true
});
// OSM-Standardkacheln: kostenlos, kein Schlüssel nötig.
// Die dunkle Optik entsteht per CSS-Filter (siehe app.css).
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(karte);

let startMarke = null, zielMarke = null, routenLinie = null;

function setzeMarke(punkt, art) {
  const symbol = L.divIcon({
    className: '',
    html: `<div class="markierung markierung-${art}"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7]
  });
  const marke = L.marker([punkt.lat, punkt.lon], { icon: symbol, keyboard: false }).addTo(karte);
  if (art === 'start') { startMarke?.remove(); startMarke = marke; }
  else { zielMarke?.remove(); zielMarke = marke; }
}

/* ---------- Elemente ---------- */
const el = {
  startFeld: document.getElementById('startFeld'),
  zielFeld: document.getElementById('zielFeld'),
  vorschlaege: document.getElementById('vorschlaege'),
  schrittZiel: document.getElementById('schritt-ziel'),
  schrittPreis: document.getElementById('schritt-preis'),
  schrittFertig: document.getElementById('schritt-fertig'),
  streckeZeile: document.getElementById('streckeZeile'),
  preisWert: document.getElementById('preisWert'),
  preisDetails: document.getElementById('preisDetails'),
  preisAufklappen: document.getElementById('preisAufklappen'),
  buchenKnopf: document.getElementById('buchenKnopf'),
  zurueckKnopf: document.getElementById('zurueckKnopf'),
  neueFahrtKnopf: document.getElementById('neueFahrtKnopf'),
  fertigText: document.getElementById('fertigText'),
  fertigTitel: document.getElementById('titel-fertig'),
  fertigZeichen: document.getElementById('fertigZeichen'),
  standortKnopf: document.getElementById('standortKnopf'),
  schnellziele: document.getElementById('schnellziele')
};

/* ---------- Adresssuche (Photon) ---------- */
let sucheTimer = null;

async function sucheAdressen(text) {
  if (text.trim().length < 3) return [];
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({
    q: text, limit: 5, lang: 'de',
    lat: WIEN[0], lon: WIEN[1],   // Treffer rund um Wien bevorzugen
    bbox: '16.18,48.10,16.58,48.33'
  });
  try {
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error('Suche nicht erreichbar');
    const daten = await antwort.json();
    return daten.features.map(f => {
      const p = f.properties;
      const teile = [p.street, p.housenumber].filter(Boolean).join(' ');
      return {
        name: p.name || teile || p.city || 'Unbenannt',
        ort: [teile && p.name ? teile : null, p.postcode, p.city || p.district]
               .filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0]
      };
    });
  } catch (e) {
    console.warn('Adresssuche fehlgeschlagen:', e);
    return null;   // null = Fehler, [] = nichts gefunden
  }
}

function zeigeVorschlaege(liste) {
  el.vorschlaege.innerHTML = '';
  if (liste === null) {
    el.vorschlaege.innerHTML =
      '<li class="hinweis-fehler">Adresssuche gerade nicht erreichbar. Bitte kurz erneut versuchen.</li>';
    el.vorschlaege.hidden = false;
    return;
  }
  if (!liste.length) { el.vorschlaege.hidden = true; return; }

  liste.forEach(ort => {
    const li = document.createElement('li');
    li.className = 'vorschlag';
    li.setAttribute('role', 'option');
    li.tabIndex = 0;
    li.innerHTML = `
      <span class="vorschlag-zeichen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
      </span>
      <span class="vorschlag-text">
        <span class="vorschlag-name">${sicher(ort.name)}</span>
        ${ort.ort ? `<span class="vorschlag-ort">${sicher(ort.ort)}</span>` : ''}
      </span>`;
    const waehlen = () => waehleOrt(ort);
    li.addEventListener('click', waehlen);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehlen(); } });
    el.vorschlaege.appendChild(li);
  });
  el.vorschlaege.hidden = false;
}

function waehleOrt(ort) {
  const feld = zustand.aktivesFeld;
  if (feld === 'start') {
    zustand.start = ort;
    el.startFeld.value = ort.name;
    setzeMarke(ort, 'start');
  } else {
    zustand.ziel = ort;
    el.zielFeld.value = ort.name;
    setzeMarke(ort, 'ziel');
  }
  el.vorschlaege.hidden = true;
  aktualisiereLoeschKnoepfe();

  if (zustand.start && zustand.ziel) berechneRoute();
  else if (!zustand.start) el.startFeld.focus();
  else el.zielFeld.focus();
}

/* Route so einpassen, dass sie nicht hinter dem Bedienfeld verschwindet.
   Am Handy liegt das Blatt unten, ab 720 px links daneben. */
function passeAusschnittAn(bereich) {
  const blatt = document.getElementById('blatt').getBoundingClientRect();
  const seitlich = window.innerWidth >= 720;
  karte.fitBounds(bereich, {
    paddingTopLeft: [seitlich ? blatt.right + 24 : 40, 90],
    paddingBottomRight: [40, seitlich ? 40 : blatt.height + 24],
    maxZoom: 16
  });
}

/* ---------- Route (OSRM) ---------- */
async function berechneRoute() {
  zeigeLaden('Route wird berechnet …');

  const von = `${zustand.start.lon},${zustand.start.lat}`;
  const nach = `${zustand.ziel.lon},${zustand.ziel.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${von};${nach}?overview=full&geometries=geojson`;

  try {
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error('Routendienst nicht erreichbar');
    const daten = await antwort.json();
    if (!daten.routes?.length) throw new Error('Keine Route gefunden');

    const r = daten.routes[0];
    zustand.route = {
      km: r.distance / 1000,
      minuten: r.duration / 60,
      linie: r.geometry.coordinates.map(([lon, lat]) => [lat, lon])
    };

    routenLinie?.remove();
    routenLinie = L.polyline(zustand.route.linie, {
      color: '#ffb020', weight: 4, opacity: .9, lineJoin: 'round'
    }).addTo(karte);
    passeAusschnittAn(routenLinie.getBounds());

    zeigePreis();
  } catch (e) {
    console.warn('Route fehlgeschlagen:', e);
    zeigeFehler('Die Route konnte gerade nicht berechnet werden. Bitte erneut versuchen.');
  }
}

/* ---------- Preis ---------- */
function zeigePreis() {
  const { km, minuten } = zustand.route;
  const preis = berechneFahrpreis(km, { funk: true });

  el.streckeZeile.textContent =
    `${km.toFixed(1)} km · etwa ${Math.round(minuten)} Minuten${preis.nacht ? ' · Nachttarif' : ''}`;
  el.preisWert.textContent = formatEuro(preis.gesamt);

  const a = preis.aufschluesselung;
  el.preisDetails.innerHTML = `
    <dt>Grundbetrag</dt><dd>${formatEuro(a.grundbetrag)}</dd>
    <dt>Strecke (${km.toFixed(1)} km)</dt><dd>${formatEuro(a.strecke)}</dd>
    ${a.funkzuschlag ? `<dt>Bestellzuschlag</dt><dd>${formatEuro(a.funkzuschlag)}</dd>` : ''}
    <dt><strong>Gesamt</strong></dt><dd><strong>${formatEuro(preis.gesamt)}</strong></dd>
    <p class="quelle">Berechnet nach dem amtlichen Wiener Taxitarif
    (${preis.nacht ? 'Nachttarif, 23–6 Uhr' : 'Tagtarif, 6–23 Uhr'}).
    Dieser Tarif gilt in Wien für alle Anbieter gleichermaßen.</p>`;

  zeigeSchritt('preis');
  // erst jetzt steht die Höhe des Blatts fest
  requestAnimationFrame(() => passeAusschnittAn(routenLinie.getBounds()));
}

/* ---------- Schritte ---------- */
function zeigeSchritt(name) {
  el.schrittZiel.hidden = name !== 'ziel';
  el.schrittPreis.hidden = name !== 'preis';
  el.schrittFertig.hidden = name !== 'fertig';
}

function zeigeLaden(text) {
  el.vorschlaege.innerHTML = `<li class="lade-hinweis"><span class="dreher"></span>${sicher(text)}</li>`;
  el.vorschlaege.hidden = false;
}
function zeigeFehler(text) {
  el.vorschlaege.innerHTML = `<li class="hinweis-fehler">${sicher(text)}</li>`;
  el.vorschlaege.hidden = false;
}

/* ---------- Ereignisse ---------- */
[['startFeld', 'start'], ['zielFeld', 'ziel']].forEach(([id, art]) => {
  const feld = el[id];
  feld.addEventListener('focus', () => { zustand.aktivesFeld = art; });
  feld.addEventListener('input', () => {
    aktualisiereLoeschKnoepfe();
    clearTimeout(sucheTimer);
    const wert = feld.value;
    if (wert.trim().length < 3) { el.vorschlaege.hidden = true; return; }
    sucheTimer = setTimeout(async () => {
      zustand.aktivesFeld = art;
      zeigeVorschlaege(await sucheAdressen(wert));
    }, 300);   // nicht bei jedem Tastendruck anfragen
  });
});

document.querySelectorAll('.feld-loeschen').forEach(knopf => {
  knopf.addEventListener('click', () => {
    const feld = document.getElementById(knopf.dataset.fuer);
    feld.value = '';
    if (knopf.dataset.fuer === 'startFeld') { zustand.start = null; startMarke?.remove(); startMarke = null; }
    else { zustand.ziel = null; zielMarke?.remove(); zielMarke = null; }
    routenLinie?.remove(); routenLinie = null; zustand.route = null;
    el.vorschlaege.hidden = true;
    aktualisiereLoeschKnoepfe();
    feld.focus();
  });
});

function aktualisiereLoeschKnoepfe() {
  document.querySelectorAll('.feld-loeschen').forEach(k => {
    k.hidden = !document.getElementById(k.dataset.fuer).value;
  });
}

el.schnellziele.addEventListener('click', async e => {
  const knopf = e.target.closest('.schnellziel');
  if (!knopf) return;
  zustand.aktivesFeld = 'ziel';
  el.zielFeld.value = knopf.dataset.ziel;
  aktualisiereLoeschKnoepfe();
  zeigeLaden('Wird gesucht …');
  const treffer = await sucheAdressen(knopf.dataset.ziel);
  if (treffer?.length) waehleOrt(treffer[0]);
  else zeigeFehler('Konnte nicht gefunden werden.');
});

el.preisAufklappen.addEventListener('click', () => {
  const offen = el.preisDetails.hidden;
  el.preisDetails.hidden = !offen;
  el.preisAufklappen.setAttribute('aria-expanded', String(offen));
  el.preisAufklappen.textContent = offen ? 'Details ausblenden' : 'Wie kommt der Preis zustande?';
});

el.zurueckKnopf.addEventListener('click', () => zeigeSchritt('ziel'));

el.buchenKnopf.addEventListener('click', async () => {
  el.buchenKnopf.disabled = true;
  el.buchenKnopf.textContent = 'Wird gesendet …';

  try {
    const auftrag = await auftragAnlegen({
      start: zustand.start, ziel: zustand.ziel,
      km: zustand.route.km, minuten: zustand.route.minuten,
      preis: berechneFahrpreis(zustand.route.km, { funk: true }).gesamt,
      nacht: istNacht()
    });
    zustand.auftragId = auftrag.id;
    zeichneAuftragszustand(auftrag);
    zeigeSchritt('fertig');
  } catch (fehler) {
    zeigeFehler(fehler.message);
  } finally {
    el.buchenKnopf.disabled = false;
    el.buchenKnopf.textContent = 'Fahrt anfragen';
  }
});

/* ---------- Was macht mein Auftrag gerade? ---------- */
function zeichneAuftragszustand(auftrag) {
  const fahrer = auftrag.fahrer;
  const wartet = auftrag.status === 'offen';

  el.fertigTitel.textContent = wartet ? 'Anfrage ist raus' : 'Fahrer gefunden';
  el.fertigZeichen.classList.toggle('sucht', wartet);

  el.fertigText.innerHTML = `
    ${fahrer ? `
      <div class="fahrer-karte">
        <span class="fahrer-bild" aria-hidden="true">${sicher(fahrer.name[0])}</span>
        <span class="fahrer-daten">
          <span class="fahrer-namenszeile">${sicher(fahrer.name)}</span>
          <span class="fahrer-autozeile">${sicher(fahrer.modell)} · ${sicher(fahrer.kennzeichen)}</span>
        </span>
      </div>` : ''}
    <p class="fahrgast-zustand${auftrag.status === 'beendet' ? ' fertig' : ''}">
      ${sicher(ZUSTAND[auftrag.status].fahrgast)}
    </p>
    <p class="fahrt-nummer">Auftragsnummer ${sicher(auftrag.id)}</p>`;

  el.neueFahrtKnopf.textContent = auftrag.status === 'beendet' ? 'Neue Fahrt' : 'Fahrt abbrechen';
}

// Der Fahrer schaltet weiter – der Fahrgast sieht es ohne Neuladen
beiAenderung(async () => {
  if (!zustand.auftragId || el.schrittFertig.hidden) return;
  const auftrag = await auftragLesen(zustand.auftragId);
  if (auftrag) zeichneAuftragszustand(auftrag);
});

el.neueFahrtKnopf.addEventListener('click', async () => {
  // Solange noch kein Fahrer fertig ist, heißt der Knopf "Fahrt abbrechen"
  const auftrag = zustand.auftragId ? await auftragLesen(zustand.auftragId) : null;
  if (auftrag && auftrag.status !== 'beendet') {
    await statusSetzen(auftrag.id, 'storniert');
  }
  zustand.auftragId = null;
  zustand.start = zustand.ziel = zustand.route = null;
  el.startFeld.value = el.zielFeld.value = '';
  startMarke?.remove(); zielMarke?.remove(); routenLinie?.remove();
  startMarke = zielMarke = routenLinie = null;
  karte.setView(WIEN, 13);
  aktualisiereLoeschKnoepfe();
  zeigeSchritt('ziel');
});

/* ---------- Eigener Standort ---------- */
el.standortKnopf.addEventListener('click', () => {
  if (!navigator.geolocation) { zeigeFehler('Standort wird von diesem Gerät nicht unterstützt.'); return; }
  el.standortKnopf.classList.add('aktiv');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const ort = {
        name: 'Mein Standort', ort: '',
        lat: pos.coords.latitude, lon: pos.coords.longitude
      };
      zustand.start = ort;
      el.startFeld.value = ort.name;
      setzeMarke(ort, 'start');
      karte.setView([ort.lat, ort.lon], 15);
      aktualisiereLoeschKnoepfe();
      el.standortKnopf.classList.remove('aktiv');
      if (zustand.ziel) berechneRoute(); else el.zielFeld.focus();
    },
    () => {
      el.standortKnopf.classList.remove('aktiv');
      zeigeFehler('Standort nicht verfügbar. Bitte Adresse eingeben.');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

/* ---------- Hilfsfunktion ---------- */
function sicher(text) {
  return String(text).replace(/[&<>"']/g, z =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

// Klick außerhalb schließt die Vorschläge
document.addEventListener('click', e => {
  if (!e.target.closest('.felder') && !e.target.closest('.vorschlaege') && !e.target.closest('.schnellziel')) {
    el.vorschlaege.hidden = true;
  }
});

aktualisiereLoeschKnoepfe();
