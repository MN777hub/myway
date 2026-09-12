/* ============================================================
   MyWay – Ziehbares Bedienblatt

   Drei Rastpunkte: nur der Kopf, halbe Höhe, ganz offen. Gezogen wird mit
   dem Daumen, losgelassen rastet es auf dem nächstgelegenen Punkt ein.

   ZWEI FALLEN, die hier bewusst behandelt sind:
   1. Zug gegen Scrollen. Wer im Blatt nach unten wischt, will scrollen und
      nicht das Blatt zuziehen. Deshalb greift der Zug nur am Griff oder
      wenn der Inhalt schon ganz oben steht.
   2. Die Karte passt sich an die Blatthöhe an. Während des Ziehens ändert
      sich die Höhe in jedem Bild – das darf erst nach dem Einrasten einmal
      ausgelöst werden, sonst rechnet die Karte sich dumm.
   ============================================================ */

const RASTEN = { klein: .32, mittel: .58, gross: .88 };   // Anteil der Fensterhöhe
const SPARSAM = matchMedia('(prefers-reduced-motion: reduce)');

export function blattEinrichten(blatt, griff) {
  let hoehe = RASTEN.mittel;
  let ziehtVon = null;
  let startHoehe = 0;
  const zuhoerer = new Set();

  const fensterHoehe = () => window.innerHeight;
  const setzen = anteil => {
    hoehe = Math.min(RASTEN.gross, Math.max(RASTEN.klein, anteil));
    blatt.style.height = `${Math.round(hoehe * fensterHoehe())}px`;
  };

  /** Nach dem Einrasten Bescheid geben – die Karte richtet sich danach. */
  const melden = () => zuhoerer.forEach(f => f(hoehe));

  function einrasten() {
    const naechster = Object.values(RASTEN)
      .reduce((a, b) => Math.abs(b - hoehe) < Math.abs(a - hoehe) ? b : a);
    blatt.style.transition = SPARSAM.matches ? 'none' : 'height .28s cubic-bezier(.22,.68,.36,1)';
    setzen(naechster);
    // Erst wenn das Blatt steht, darf sich die Karte neu ausrichten
    setTimeout(() => { blatt.style.transition = ''; melden(); }, SPARSAM.matches ? 0 : 300);
  }

  function darfZiehen(ereignis) {
    if (griff.contains(ereignis.target)) return true;
    // Im Inhalt nur ziehen, wenn oben nichts mehr wegzuscrollen ist
    return blatt.scrollTop <= 0;
  }

  blatt.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!darfZiehen(e)) return;
    ziehtVon = e.clientY;
    startHoehe = hoehe;
    blatt.style.transition = 'none';
  });

  blatt.addEventListener('pointermove', e => {
    if (ziehtVon === null) return;
    const weg = ziehtVon - e.clientY;           // nach oben ziehen = größer
    const neu = startHoehe + weg / fensterHoehe();

    // Solange nach unten gezogen wird und der Inhalt gescrollt ist, gehört
    // die Geste dem Scrollen – Zug abbrechen statt dagegenzuhalten
    if (neu < startHoehe && blatt.scrollTop > 0) { ziehtVon = null; return; }

    if (Math.abs(weg) > 4) {
      blatt.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
    setzen(neu);
  });

  const loslassen = e => {
    if (ziehtVon === null) return;
    ziehtVon = null;
    blatt.releasePointerCapture?.(e.pointerId);
    einrasten();
  };
  blatt.addEventListener('pointerup', loslassen);
  blatt.addEventListener('pointercancel', loslassen);

  window.addEventListener('resize', () => setzen(hoehe));
  setzen(hoehe);

  return {
    /** Von außen auf einen Rastpunkt setzen, z. B. beim Schrittwechsel. */
    zeigeAuf(name) {
      blatt.style.transition = SPARSAM.matches ? 'none' : 'height .28s cubic-bezier(.22,.68,.36,1)';
      setzen(RASTEN[name] ?? RASTEN.mittel);
      setTimeout(() => { blatt.style.transition = ''; melden(); }, SPARSAM.matches ? 0 : 300);
    },
    beiHoehenwechsel(f) { zuhoerer.add(f); return () => zuhoerer.delete(f); },
    get anteil() { return hoehe; }
  };
}
