/* ============================================================
   MyWay – Fahrgast-Ansicht
   Alle Dienste kostenlos, ohne Registrierung:
     Karte    OpenStreetMap
     Adressen Photon (Komoot)
     Route    OSRM
   ============================================================ */

import { berechneFahrpreis, aufteilung, formatEuro, formatKm, istNacht } from './tarif.js';
import { auftragAnlegen, auftragLesen, statusSetzen, bewerten, fahrtVerfolgen, beiAenderung, ZUSTAND, ABLAUF } from './daten.js';
import { entfernung, fahrzeitMinuten } from './geo.js';
import { bewegeMarker, kurs as kursWinkel } from './bewegung.js';
import { blattEinrichten } from './blatt.js';

const WIEN = [48.2082, 16.3738];

const zustand = {
  start: null,   // { name, ort, lat, lon }
  ziel: null,
  route: null,   // { km, minuten, linie }
  aktivesFeld: null,
  auftragId: null,
  zahlartWunsch: 'karte',
  merkModus: null   // 'zuhause' | 'arbeit', während ein Ort gemerkt wird
};

const ORTE_SCHLUESSEL = 'myway_orte';

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
  ankunftZeit: document.getElementById('ankunftZeit'),
  ankunftLive: document.getElementById('ankunftLive'),
  warteHinweis: document.getElementById('warteHinweis'),
  anteilZeile: document.getElementById('anteilZeile'),
  fgFortschritt: document.getElementById('fahrgastFortschritt'),
  fgSpur: document.getElementById('fgFortschrittSpur'),
  fgZaehler: document.getElementById('fgFortschrittZaehler'),
  fahrtAktionen: document.getElementById('fahrtAktionen'),
  anrufKnopf: document.getElementById('anrufKnopf'),
  teilenKnopf: document.getElementById('teilenKnopf'),
  bewertung: document.getElementById('bewertung'),
  sterne: document.getElementById('sterne'),
  bewertungDank: document.getElementById('bewertungDank'),
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
let letzterBereich = null;

function passeAusschnittAn(bereich) {
  letzterBereich = bereich;
  const blatt = document.getElementById('blatt').getBoundingClientRect();
  const seitlich = window.innerWidth >= 720;
  karte.fitBounds(bereich, {
    paddingTopLeft: [seitlich ? blatt.right + 24 : 40, 90],
    paddingBottomRight: [40, seitlich ? 40 : blatt.height + 24],
    maxZoom: 16
  });
}

/* Das Blatt lässt sich ziehen und wächst beim Aufklappen der Preisdetails.
   Beides ändert die Höhe – danach muss die Karte neu eingepasst werden,
   aber erst danach: währenddessen würde sie in jedem Bild neu rechnen. */
const blatt = blattEinrichten(
  document.getElementById('blatt'),
  document.querySelector('.blatt-griff')
);
blatt.beiHoehenwechsel(() => { if (letzterBereich) passeAusschnittAn(letzterBereich); });

if ('ResizeObserver' in window) {
  let warten = null;
  new ResizeObserver(() => {
    if (!letzterBereich) return;
    clearTimeout(warten);
    warten = setTimeout(() => passeAusschnittAn(letzterBereich), 180);
  }).observe(document.getElementById('blatt'));
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

/** Wann ist der Fahrgast da? Fahrzeit plus ein Puffer für die Anfahrt.
    Bewusst mit „ca." beschriftet – niemand kann das auf die Minute wissen. */
function ankunftszeit(fahrminuten) {
  const ANFAHRT_PUFFER = 6;
  const an = new Date(Date.now() + (fahrminuten + ANFAHRT_PUFFER) * 60000);
  return an.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function zeigePreis() {
  const { km, minuten } = zustand.route;
  const preis = berechneFahrpreis(km, { funk: true });

  el.streckeZeile.innerHTML =
    `<span>${formatKm(km)} km · etwa ${Math.round(minuten)} Minuten</span>` +
    (preis.nacht ? '<span class="tarif-marke">Nachttarif</span>' : '');
  el.preisWert.textContent = formatEuro(preis.gesamt);
  el.ankunftZeit.textContent = 'ca. ' + ankunftszeit(minuten);

  // Offen hinschreiben, was beim Fahrer bleibt. Genau das verschweigt Uber.
  const anteil = aufteilung(preis.gesamt);
  el.anteilZeile.innerHTML =
    `Von deinen ${formatEuro(preis.gesamt)} bekommt dein Fahrer ` +
    `<strong>${formatEuro(anteil.fahrer)}</strong>. MyWay behält ${formatEuro(anteil.myway)}.`;

  const a = preis.aufschluesselung;
  el.preisDetails.innerHTML = `
    <dt>Grundbetrag</dt><dd>${formatEuro(a.grundbetrag)}</dd>
    <dt>Strecke (${formatKm(km)} km)</dt><dd>${formatEuro(a.strecke)}</dd>
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
  document.getElementById('schritt-verfolgen').hidden = name !== 'verfolgen';
  document.querySelector('.seiten-wechsel').hidden = name === 'verfolgen';
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

  // Zuhause und Arbeit: gesetzt ist es ein Ziel, ungesetzt merkt es sich
  // das, was gerade im Zielfeld steht.
  if (knopf.dataset.merk) {
    const gemerkt = orteLesen()[knopf.dataset.merk];
    if (gemerkt) {
      zustand.aktivesFeld = 'ziel';
      waehleOrt(gemerkt);
      return;
    }
    if (!zustand.ziel) {
      zeigeFehler(`Gib zuerst ein Ziel ein, dann merke ich es als „${knopf.textContent.trim()}".`);
      return;
    }
    ortSchreiben(knopf.dataset.merk, zustand.ziel);
    return;
  }

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
      nacht: istNacht(),
      zahlartWunsch: zustand.zahlartWunsch
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

/* Das Auto des Fahrers. Ein eigener Marker, damit Start und Ziel bleiben,
   wo sie sind. */
let autoMarke = null;
let bewegungAbbrechen = null;
let letzteAutoPos = null;

function zeigeAuto(pos) {
  if (!pos) return;
  const winkel = letzteAutoPos ? kursWinkel(letzteAutoPos, pos) : 0;
  letzteAutoPos = pos;

  if (!autoMarke) {
    autoMarke = L.marker([pos.lat, pos.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="auto-marke"><svg viewBox="0 0 24 24"><path d="M12 2l7 18-7-4-7 4z" fill="currentColor"/></svg></div>`,
        iconSize: [34, 34], iconAnchor: [17, 17]
      }),
      keyboard: false, zIndexOffset: 1000
    }).addTo(karte);
  } else {
    bewegungAbbrechen?.();
    bewegungAbbrechen = bewegeMarker(autoMarke, pos);
  }
  const zeichen = autoMarke.getElement()?.querySelector('.auto-marke');
  if (zeichen) zeichen.style.rotate = `${winkel}deg`;
}

function autoEntfernen() {
  bewegungAbbrechen?.();
  autoMarke?.remove();
  autoMarke = null; letzteAutoPos = null; bewegungAbbrechen = null;
}

/** Wie lange noch, bis der Fahrer da ist? */
function zeigeLiveAnkunft(auftrag) {
  const pos = auftrag.fahrer_pos;
  const vorEinstieg = ['angenommen', 'unterwegs', 'beim_fahrgast'].includes(auftrag.status);
  if (!pos || !vorEinstieg || auftrag.status === 'beim_fahrgast') {
    el.ankunftLive.hidden = auftrag.status !== 'beim_fahrgast';
    if (auftrag.status === 'beim_fahrgast') {
      el.ankunftLive.textContent = `${auftrag.fahrer?.name ?? 'Dein Fahrer'} wartet vor Ort.`;
    }
    return;
  }
  const km = entfernung(pos, auftrag.start);
  const min = fahrzeitMinuten(km);
  el.ankunftLive.innerHTML =
    `${sicher(auftrag.fahrer?.name ?? 'Dein Fahrer')} ist in <strong>${min} Min</strong> da`;
  el.ankunftLive.hidden = false;
}

function zeichneFahrgastFortschritt(status) {
  const jetzt = ABLAUF.indexOf(status);
  if (jetzt < 0) { el.fgFortschritt.hidden = true; return; }
  el.fgFortschritt.hidden = false;
  el.fgSpur.innerHTML = ABLAUF.map((_, i) =>
    `<span class="fortschritt-teil ${i < jetzt ? 'erledigt' : i === jetzt ? 'jetzt' : ''}"></span>`
  ).join('');
  el.fgZaehler.textContent = `Schritt ${jetzt + 1} von ${ABLAUF.length}`;
}

function zeichneAuftragszustand(auftrag) {
  const fahrer = auftrag.fahrer;
  const wartet = auftrag.status === 'offen';
  const fertig = auftrag.status === 'beendet';

  el.fertigTitel.textContent = wartet ? 'Anfrage ist raus' : fertig ? 'Angekommen' : 'Fahrer gefunden';
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
    <p class="fahrgast-zustand${fertig ? ' fertig' : ''}">
      ${sicher(ZUSTAND[auftrag.status].fahrgast)}
    </p>
    <p class="fahrt-nummer">Auftragsnummer ${sicher(auftrag.id)}</p>`;

  zeichneFahrgastFortschritt(auftrag.status);
  zeigeLiveAnkunft(auftrag);
  zeigeAuto(auftrag.fahrer_pos);

  // Anrufen und Teilen ergeben nur Sinn, solange die Fahrt läuft
  const laeuft = fahrer && !fertig && auftrag.status !== 'storniert';
  el.fahrtAktionen.hidden = !laeuft;
  if (laeuft) {
    el.anrufKnopf.href = fahrer.telefon ? `tel:${fahrer.telefon.replace(/\s/g, '')}` : '#';
    el.anrufKnopf.hidden = !fahrer.telefon;
  }

  el.bewertung.hidden = !fertig || auftrag.bewertung != null;
  if (fertig) autoEntfernen();

  el.warteHinweis.hidden = !wartet;
  el.neueFahrtKnopf.textContent = fertig ? 'Neue Fahrt' : 'Fahrt abbrechen';
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
  autoEntfernen();
  el.bewertungDank.hidden = true;
  [...el.sterne.children].forEach(s => { s.classList.remove('voll'); s.setAttribute('aria-checked', 'false'); });
  karte.setView(WIEN, 13);
  aktualisiereLoeschKnoepfe();
  zeigeSchritt('ziel');
});

/* ---------- Eigener Standort ---------- */

/**
 * Standort holen und als Startadresse eintragen.
 * @param {boolean} leise  true = im Hintergrund, ohne Fehlermeldung und
 *                         ohne dem Fahrgast den Fokus wegzunehmen.
 */
function standortUebernehmen(leise = false) {
  if (!navigator.geolocation) {
    if (!leise) zeigeFehler('Standort wird von diesem Gerät nicht unterstützt.');
    return;
  }
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
      if (zustand.ziel) berechneRoute();
      else if (!leise) el.zielFeld.focus();
    },
    () => {
      el.standortKnopf.classList.remove('aktiv');
      if (!leise) zeigeFehler('Standort nicht verfügbar. Bitte Adresse eingeben.');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

el.standortKnopf.addEventListener('click', () => standortUebernehmen(false));

/* Wer den Standort schon einmal freigegeben hat, will ihn nicht bei jedem
   Aufruf erneut antippen. Nur bei bereits erteilter Freigabe – ein
   ungefragter Rechtedialog beim ersten Öffnen wäre übergriffig. */
navigator.permissions?.query({ name: 'geolocation' })
  .then(recht => { if (recht.state === 'granted') standortUebernehmen(true); })
  .catch(() => { /* Safari kennt die Abfrage nicht – dann eben nicht */ });

/* ---------- Zahlungsmittel ---------- */
document.querySelectorAll('.zahlart-knopf[data-wunsch]').forEach(knopf => {
  knopf.addEventListener('click', () => {
    document.querySelectorAll('.zahlart-knopf[data-wunsch]')
      .forEach(k => k.classList.remove('gewaehlt'));
    knopf.classList.add('gewaehlt');
    zustand.zahlartWunsch = knopf.dataset.wunsch;
  });
});

/* ---------- Fahrt teilen ----------
   Der Link führt auf eine abgespeckte Sicht: Status, Fahrer, Position.
   Kein Preis, kein Ziel – wer ihn bekommt, soll sehen dass jemand gut
   ankommt, und nicht wohin und für wie viel. */
el.teilenKnopf.addEventListener('click', async () => {
  const auftrag = await auftragLesen(zustand.auftragId);
  if (!auftrag) return;
  const adresse = new URL(location.href);
  adresse.search = `?fahrt=${auftrag.id}&s=${auftrag.geheimnis}`;
  const text = `Ich bin mit MyWay unterwegs. Hier kannst du mitschauen:`;

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Meine MyWay-Fahrt', text, url: adresse.toString() });
    } else {
      await navigator.clipboard.writeText(adresse.toString());
      el.teilenKnopf.classList.add('erledigt');
      el.teilenKnopf.lastChild.textContent = ' Link kopiert';
      setTimeout(() => {
        el.teilenKnopf.classList.remove('erledigt');
        el.teilenKnopf.lastChild.textContent = ' Fahrt teilen';
      }, 2500);
    }
  } catch (e) {
    // Abgebrochenes Teilen ist kein Fehler
    if (e.name !== 'AbortError') console.warn('Teilen:', e);
  }
});

/* ---------- Bewertung ---------- */
el.sterne.innerHTML = [1, 2, 3, 4, 5].map(n =>
  `<button class="stern" data-note="${n}" role="radio" aria-checked="false"
           aria-label="${n} von 5 Sternen">
    <svg viewBox="0 0 24 24"><path d="M12 2l3 6.6 7 .9-5.1 4.9 1.3 7L12 18l-6.2 3.4 1.3-7L2 9.5l7-.9z"
      fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  </button>`).join('');

el.sterne.addEventListener('click', async e => {
  const knopf = e.target.closest('.stern');
  if (!knopf) return;
  const note = Number(knopf.dataset.note);
  [...el.sterne.children].forEach((s, i) => {
    s.classList.toggle('voll', i < note);
    s.setAttribute('aria-checked', String(i + 1 === note));
  });
  try {
    await bewerten(zustand.auftragId, note);
    el.bewertungDank.hidden = false;
  } catch (fehler) {
    el.bewertungDank.textContent = fehler.message;
    el.bewertungDank.hidden = false;
  }
});

/* ---------- Gemerkte Orte ----------
   Zuhause und Arbeit liegen nur auf dem Gerät. Sie gehen niemanden sonst
   etwas an und brauchen dafür keinen Platz in der Datenbank. */
function orteLesen() {
  try { return JSON.parse(localStorage.getItem(ORTE_SCHLUESSEL) || '{}'); }
  catch (e) { return {}; }
}
function ortSchreiben(art, ort) {
  const alle = orteLesen();
  alle[art] = ort;
  try { localStorage.setItem(ORTE_SCHLUESSEL, JSON.stringify(alle)); } catch (e) { /* privater Modus */ }
  zeichneMerkChips();
}
function zeichneMerkChips() {
  const alle = orteLesen();
  document.querySelectorAll('.merkbar').forEach(chip => {
    const ort = alle[chip.dataset.merk];
    chip.classList.toggle('gesetzt', Boolean(ort));
    chip.title = ort ? ort.name : 'Noch nicht gesetzt – tippen, um das aktuelle Ziel zu merken';
  });
}
zeichneMerkChips();

/* ---------- Geteilter Link: nur mitschauen ----------
   Kein Realtime hier: Wer den Link öffnet, ist nicht der Fahrgast und darf
   die Zeile gar nicht lesen. Die abgespeckte Sicht kommt über eine Funktion,
   die das Geheimnis aus dem Link prüft – also wird gepollt. */
async function verfolgenStarten(id, geheimnis) {
  zeigeSchritt('verfolgen');
  document.querySelector('.kopf').classList.add('nur-marke');

  const zeichnen = async () => {
    let fahrt;
    try {
      fahrt = await fahrtVerfolgen(id, geheimnis);
    } catch (e) {
      document.getElementById('vfStatus').textContent = 'Diese Fahrt ist nicht abrufbar.';
      return false;
    }
    if (!fahrt) {
      document.getElementById('vfStatus').textContent =
        'Diese Fahrt gibt es nicht oder der Link stimmt nicht.';
      return false;
    }

    const jetzt = ABLAUF.indexOf(fahrt.status);
    document.getElementById('vfSpur').innerHTML = ABLAUF.map((_, i) =>
      `<span class="fortschritt-teil ${i < jetzt ? 'erledigt' : i === jetzt ? 'jetzt' : ''}"></span>`
    ).join('');
    document.getElementById('vfZaehler').textContent =
      jetzt >= 0 ? `Schritt ${jetzt + 1} von ${ABLAUF.length}` : '';
    document.getElementById('vfStatus').textContent = ZUSTAND[fahrt.status]?.text ?? '';

    document.getElementById('vfFahrer').innerHTML = fahrt.fahrer ? `
      <div class="fahrer-karte">
        <span class="fahrer-bild" aria-hidden="true">${sicher(fahrt.fahrer.name[0])}</span>
        <span class="fahrer-daten">
          <span class="fahrer-namenszeile">${sicher(fahrt.fahrer.name)}</span>
          <span class="fahrer-autozeile">${sicher(fahrt.fahrer.modell)} · ${sicher(fahrt.fahrer.kennzeichen)}</span>
        </span>
      </div>` : '<p class="warte-hinweis">Es sucht noch ein Fahrer.</p>';

    if (fahrt.fahrer_pos) {
      zeigeAuto(fahrt.fahrer_pos);
      const start = { lat: Number(fahrt.start.lat), lon: Number(fahrt.start.lon) };
      setzeMarke({ ...start, name: 'Abholung' }, 'start');
      passeAusschnittAn(L.latLngBounds(
        [fahrt.fahrer_pos.lat, fahrt.fahrer_pos.lon], [start.lat, start.lon]));
    }
    return !['beendet', 'storniert'].includes(fahrt.status);
  };

  if (await zeichnen()) {
    const takt = setInterval(async () => {
      if (!await zeichnen()) clearInterval(takt);
    }, 5000);
  }
}

/* ---------- Hilfsfunktion ---------- */
function sicher(text) {
  return String(text).replace(/[&<>"']/g, z =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

/* ---------- Start ----------
   Führt ein geteilter Link hierher, wird gar nicht erst die Buchung
   aufgebaut – der Besucher will mitschauen, nicht bestellen. */
(function start() {
  const p = new URLSearchParams(location.search);
  const id = p.get('fahrt'), geheimnis = p.get('s');
  if (id && geheimnis) verfolgenStarten(id, geheimnis);
})();

// Klick außerhalb schließt die Vorschläge
document.addEventListener('click', e => {
  if (!e.target.closest('.felder') && !e.target.closest('.vorschlaege') && !e.target.closest('.schnellziel')) {
    el.vorschlaege.hidden = true;
  }
});

aktualisiereLoeschKnoepfe();
