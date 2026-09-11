/* ============================================================
   MyWay – Fahrer-Ansicht
   Aufträge sehen, annehmen, Fahrt abwickeln, Verdienst sehen.
   ============================================================ */

import { berechneFahrpreis, aufteilung, vergleich, formatEuro } from './tarif.js';
import {
  ZUSTAND, ABLAUF, fahrerPruefen, beiAenderung,
  offeneAuftraege, auftragAnnehmen, statusSetzen,
  laufendeFahrt, fahrtenHeute, auftragLesen
} from './daten.js';

const WIEN = [48.2082, 16.3738];
const GEMERKT = 'myway_fahrer';

const zustand = {
  fahrer: null,
  verfuegbar: false,
  fahrtId: null
};

/* ---------- Karte ---------- */
const karte = L.map('karte', { center: WIEN, zoom: 12, zoomControl: false });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap'
}).addTo(karte);

let routenLinie = null, startMarke = null, zielMarke = null;

function setzeMarke(punkt, art) {
  const symbol = L.divIcon({
    className: '', html: `<div class="markierung markierung-${art}"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7]
  });
  const marke = L.marker([punkt.lat, punkt.lon], { icon: symbol, keyboard: false }).addTo(karte);
  if (art === 'start') { startMarke?.remove(); startMarke = marke; }
  else { zielMarke?.remove(); zielMarke = marke; }
}

function karteLeeren() {
  routenLinie?.remove(); startMarke?.remove(); zielMarke?.remove();
  routenLinie = startMarke = zielMarke = null;
}

/** Route der laufenden Fahrt zeichnen (OSRM). */
async function zeigeRoute(auftrag) {
  karteLeeren();
  setzeMarke(auftrag.start, 'start');
  setzeMarke(auftrag.ziel, 'ziel');

  const von = `${auftrag.start.lon},${auftrag.start.lat}`;
  const nach = `${auftrag.ziel.lon},${auftrag.ziel.lat}`;
  try {
    const antwort = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${von};${nach}?overview=full&geometries=geojson`);
    if (!antwort.ok) throw new Error('Routendienst nicht erreichbar');
    const daten = await antwort.json();
    const linie = daten.routes?.[0]?.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (!linie) throw new Error('Keine Route');
    routenLinie = L.polyline(linie, { color: '#ffb020', weight: 4, opacity: .9, lineJoin: 'round' }).addTo(karte);
    passeAusschnittAn(routenLinie.getBounds());
  } catch (e) {
    // Ohne Route ist die Fahrt trotzdem machbar – nur die beiden Punkte zeigen
    console.warn('Route nicht darstellbar:', e);
    passeAusschnittAn(L.latLngBounds(
      [auftrag.start.lat, auftrag.start.lon], [auftrag.ziel.lat, auftrag.ziel.lon]));
  }
}

function passeAusschnittAn(bereich) {
  const blatt = document.getElementById('blatt').getBoundingClientRect();
  const seitlich = window.innerWidth >= 720;
  karte.fitBounds(bereich, {
    paddingTopLeft: [seitlich ? blatt.right + 24 : 40, 90],
    paddingBottomRight: [40, seitlich ? 40 : blatt.height + 24],
    maxZoom: 16
  });
}

/* ---------- Elemente ---------- */
const el = id => document.getElementById(id);

/* ---------- Schritte ---------- */
function zeigeSchritt(name) {
  ['zugang', 'bereit', 'fahrt', 'abrechnung'].forEach(s => {
    el('schritt-' + s).hidden = s !== name;
  });
  el('abmeldenKnopf').hidden = name === 'zugang';
}

/* ---------- Anmeldung ---------- */
el('zugangForm').addEventListener('submit', e => {
  e.preventDefault();
  const fahrer = fahrerPruefen(el('codeFeld').value);
  if (!fahrer) {
    el('codeFehler').textContent = 'Dieser Code ist uns nicht bekannt. Bitte prüfe die Schreibweise.';
    el('codeFehler').hidden = false;
    return;
  }
  el('codeFehler').hidden = true;
  anmelden(fahrer);
});

function anmelden(fahrer) {
  zustand.fahrer = fahrer;
  try { localStorage.setItem(GEMERKT, fahrer.id); } catch (e) { /* privater Modus */ }
  el('fahrerName').textContent = fahrer.name;
  el('fahrerAuto').textContent = `${fahrer.modell} · ${fahrer.kennzeichen}`;
  zeichneAlles();
}

el('abmeldenKnopf').addEventListener('click', () => {
  zustand.fahrer = null;
  zustand.verfuegbar = false;
  zustand.fahrtId = null;
  try { localStorage.removeItem(GEMERKT); } catch (e) { /* egal */ }
  karteLeeren();
  karte.setView(WIEN, 12);
  el('codeFeld').value = '';
  zeigeSchritt('zugang');
});

/* ---------- Verfügbar-Schalter ---------- */
el('verfuegbarSchalter').addEventListener('click', () => {
  zustand.verfuegbar = !zustand.verfuegbar;
  const s = el('verfuegbarSchalter');
  s.setAttribute('aria-checked', String(zustand.verfuegbar));
  s.classList.toggle('an', zustand.verfuegbar);
  el('schalterText').textContent = zustand.verfuegbar ? 'Verfügbar' : 'Nicht verfügbar';
  zeichneAuftraege();
});

/* ---------- Auftragsliste ---------- */
async function zeichneAuftraege() {
  const liste = el('auftraege');

  if (!zustand.verfuegbar) {
    liste.innerHTML = `<li class="leer-hinweis">
      Du bist gerade nicht verfügbar. Schalte oben um, dann bekommst du Anfragen.</li>`;
    return;
  }

  const offene = await offeneAuftraege();
  if (!offene.length) {
    liste.innerHTML = `<li class="leer-hinweis">
      Gerade keine Anfragen. Sobald eine reinkommt, erscheint sie hier von selbst.</li>`;
    return;
  }

  liste.innerHTML = '';
  offene.forEach(a => {
    const preis = a.preis ?? berechneFahrpreis(a.km).gesamt;
    const meins = aufteilung(preis).fahrer;
    const beiUber = vergleich(preis).find(v => v.name === 'Uber').fahrer;
    const mehr = Math.round((meins - beiUber) * 100) / 100;

    const li = document.createElement('li');
    li.className = 'auftrag';
    li.innerHTML = `
      <div class="auftrag-strecke">
        <div class="strecke-punkt">
          <span class="punkt punkt-start" aria-hidden="true"></span>
          <span class="strecke-name">${sicher(a.start.name)}</span>
        </div>
        <div class="strecke-strich klein" aria-hidden="true"></div>
        <div class="strecke-punkt">
          <span class="punkt punkt-ziel" aria-hidden="true"></span>
          <span class="strecke-name">${sicher(a.ziel.name)}</span>
        </div>
      </div>
      <p class="auftrag-zeile">${a.km.toFixed(1)} km · etwa ${Math.round(a.minuten)} Min · Fahrpreis ${formatEuro(preis)}</p>
      <div class="auftrag-geld">
        <div>
          <span class="auftrag-anteil">${formatEuro(meins)}</span>
          <span class="auftrag-anteil-label">bleiben bei dir</span>
        </div>
        <span class="auftrag-vergleich">+ ${formatEuro(mehr)} gegenüber Uber</span>
      </div>
      <button class="haupt-knopf annehmen" data-id="${a.id}">Fahrt annehmen</button>`;
    liste.appendChild(li);
  });
}

el('auftraege').addEventListener('click', async e => {
  const knopf = e.target.closest('.annehmen');
  if (!knopf) return;
  knopf.disabled = true;
  knopf.textContent = 'Wird übernommen …';
  try {
    const auftrag = await auftragAnnehmen(knopf.dataset.id, zustand.fahrer);
    zustand.fahrtId = auftrag.id;
    zeigeFahrt(auftrag);
  } catch (fehler) {
    // Jemand war schneller – das ist kein Absturz, sondern Alltag
    knopf.closest('.auftrag').innerHTML =
      `<p class="hinweis-fehler">${sicher(fehler.message)}</p>`;
    setTimeout(zeichneAuftraege, 2000);
  }
});

/* ---------- Laufende Fahrt ---------- */
async function zeigeFahrt(auftrag) {
  const preis = auftrag.preis ?? berechneFahrpreis(auftrag.km).gesamt;
  const teil = aufteilung(preis);

  el('zustandMarke').textContent = ZUSTAND[auftrag.status].text;
  el('fahrtNummer').textContent = auftrag.id;
  el('fahrtStart').textContent = auftrag.start.name;
  el('fahrtStartOrt').textContent = auftrag.start.ort || '';
  el('fahrtZiel').textContent = auftrag.ziel.name;
  el('fahrtZielOrt').textContent = auftrag.ziel.ort || '';
  el('fahrtKm').textContent = auftrag.km.toFixed(1) + ' km';
  el('fahrtPreis').textContent = formatEuro(preis);
  el('fahrtAnteil').textContent = formatEuro(teil.fahrer);

  // Vor dem Einsteigen zum Fahrgast, danach zum Ziel navigieren
  const vorEinstieg = ['angenommen', 'unterwegs'].includes(auftrag.status);
  const punkt = vorEinstieg ? auftrag.start : auftrag.ziel;
  el('navigationKnopf').href =
    `https://www.google.com/maps/dir/?api=1&destination=${punkt.lat},${punkt.lon}&travelmode=driving`;
  el('navigationKnopf').textContent =
    vorEinstieg ? 'Zum Fahrgast navigieren' : 'Zum Ziel navigieren';

  const naechster = ABLAUF[ABLAUF.indexOf(auftrag.status) + 1];
  const beschriftung = {
    unterwegs: 'Ich bin unterwegs',
    beim_fahrgast: 'Ich bin da',
    laeuft: 'Fahrt gestartet',
    beendet: 'Fahrt beenden'
  };
  el('weiterKnopf').textContent = beschriftung[naechster] || 'Fahrt beenden';
  el('weiterKnopf').dataset.naechster = naechster || 'beendet';
  el('weiterKnopf').disabled = false;

  zeigeSchritt('fahrt');
  zeigeRoute(auftrag);
}

el('weiterKnopf').addEventListener('click', async () => {
  const knopf = el('weiterKnopf');
  knopf.disabled = true;
  const naechster = knopf.dataset.naechster;
  try {
    const auftrag = await statusSetzen(zustand.fahrtId, naechster);
    if (naechster === 'beendet') zeigeAbrechnung(auftrag);
    else zeigeFahrt(auftrag);
  } catch (fehler) {
    knopf.disabled = false;
    alert(fehler.message);
  }
});

/* ---------- Abrechnung ---------- */
function zeigeAbrechnung(auftrag) {
  const preis = auftrag.preis ?? berechneFahrpreis(auftrag.km).gesamt;
  const teil = aufteilung(preis);
  const beiUber = vergleich(preis).find(v => v.name === 'Uber').fahrer;

  el('abrechnungDetails').innerHTML = `
    <dt>Fahrpreis</dt><dd>${formatEuro(preis)}</dd>
    <dt>MyWay-Provision (12 %)</dt><dd>− ${formatEuro(teil.myway)}</dd>
    <dt><strong>Für dich</strong></dt><dd><strong>${formatEuro(teil.fahrer)}</strong></dd>
    <p class="quelle">Bei Uber (28 %) wären dir ${formatEuro(beiUber)} geblieben –
    ${formatEuro(Math.round((teil.fahrer - beiUber) * 100) / 100)} weniger.</p>`;

  el('zahlartHinweis').hidden = true;
  el('fertigKnopf').disabled = true;
  document.querySelectorAll('.zahlart-knopf').forEach(k => k.classList.remove('gewaehlt'));
  zeigeSchritt('abrechnung');
  karteLeeren();
}

document.querySelectorAll('.zahlart-knopf').forEach(knopf => {
  knopf.addEventListener('click', async () => {
    document.querySelectorAll('.zahlart-knopf').forEach(k => k.classList.remove('gewaehlt'));
    knopf.classList.add('gewaehlt');

    const art = knopf.dataset.art;
    const auftrag = await auftragLesen(zustand.fahrtId);
    const teil = aufteilung(auftrag.preis ?? berechneFahrpreis(auftrag.km).gesamt);

    // Der Barzahlungs-Fall ist der wunde Punkt des Geschäftsmodells.
    // Er wird hier offen benannt statt versteckt.
    el('zahlartHinweis').textContent = art === 'karte'
      ? `Erledigt. ${formatEuro(teil.fahrer)} werden dir überwiesen, die Provision ist bereits abgezogen.`
      : `Du hast ${formatEuro(auftrag.preis)} bar bekommen. ${formatEuro(teil.myway)} Provision werden mit deiner nächsten Abrechnung verrechnet.`;
    el('zahlartHinweis').hidden = false;

    await statusSetzen(zustand.fahrtId, 'beendet', { zahlart: art });
    el('fertigKnopf').disabled = false;
  });
});

el('fertigKnopf').addEventListener('click', () => {
  zustand.fahrtId = null;
  karte.setView(WIEN, 12);
  zeichneAlles();
});

/* ---------- Verdienst heute ---------- */
async function zeichneVerdienst() {
  const fahrten = await fahrtenHeute(zustand.fahrer.id);
  let verdient = 0, gespart = 0;
  fahrten.forEach(a => {
    const preis = a.preis ?? berechneFahrpreis(a.km).gesamt;
    verdient += aufteilung(preis).fahrer;
    gespart += aufteilung(preis).fahrer - vergleich(preis).find(v => v.name === 'Uber').fahrer;
  });
  el('wertFahrten').textContent = fahrten.length;
  el('labelFahrten').textContent = fahrten.length === 1 ? 'Fahrt heute' : 'Fahrten heute';
  el('wertVerdienst').textContent = formatEuro(Math.round(verdient * 100) / 100);
  el('wertGespart').textContent = '+ ' + formatEuro(Math.round(gespart * 100) / 100);
}

/* ---------- Gesamtbild zeichnen ---------- */
async function zeichneAlles() {
  if (!zustand.fahrer) { zeigeSchritt('zugang'); return; }

  const laufend = await laufendeFahrt(zustand.fahrer.id);
  if (laufend) {
    zustand.fahrtId = laufend.id;
    zeigeFahrt(laufend);
    return;
  }
  await zeichneVerdienst();
  await zeichneAuftraege();
  zeigeSchritt('bereit');
}

/* Neue Anfrage eines Fahrgasts: Liste erneuern, ohne die laufende Arbeit zu stören */
beiAenderung(async () => {
  if (!zustand.fahrer) return;
  if (!el('schritt-bereit').hidden) {
    await zeichneVerdienst();
    await zeichneAuftraege();
  }
});

/* ---------- Hilfsfunktion ---------- */
function sicher(text) {
  return String(text).replace(/[&<>"']/g, z =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

/* ---------- Start ---------- */
(function start() {
  let gemerkt = null;
  try { gemerkt = localStorage.getItem(GEMERKT); } catch (e) { /* privater Modus */ }
  const fahrer = gemerkt && fahrerPruefen(gemerkt);
  if (fahrer) anmelden(fahrer);
  else zeigeSchritt('zugang');
})();
