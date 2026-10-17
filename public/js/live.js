// Modo en directo: solo los días con partidos del grupo, la web consulta la API de la federación
// cada 2 minutos (mientras la pestaña está visible) y aplica los marcadores que vayan publicando.
// En minibasket la federación no da el marcador en vivo: llega cuando se cierra el acta, normalmente
// al poco de acabar. La URL (con el token público de basketbasko.com) la genera update.mjs en data/directo.json.
const EVERY_MS = 2 * 60_000;
const FIRST_HOUR = 8;
const LAST_HOUR = 22;

function decode(body) {
  const t = body.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const bytes = Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function scoresFrom(raw) {
  const out = new Map();
  for (const round of Object.values(raw?.messageData?.rounds ?? {})) {
    for (const m of Object.values(round.matches ?? {})) {
      if (m.localScore != null && m.visitorScore != null) {
        out.set(String(m.idMatch), { local: Number(m.localScore), visitante: Number(m.visitorScore) });
      }
    }
  }
  return out;
}

const madridHour = () =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

export async function startLive({ onScores, onStatus }) {
  let url;
  try {
    const r = await fetch('data/directo.json', { cache: 'no-cache' });
    if (!r.ok) return;
    url = (await r.json()).url;
  } catch {
    return; // sin configuración no hay directo; la web sigue con los datos del último build
  }
  if (!url) return;

  let timer = null;
  const time = () => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', timeStyle: 'short' }).format(new Date());

  async function poll() {
    const hour = madridHour();
    if (hour < FIRST_HOUR || hour >= LAST_HOUR) { onStatus(''); return; }
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      onScores(scoresFrom(decode(await res.text())));
      onStatus(`● Día de partido: resultados actualizados a las ${time()} (cada 2 min)`);
    } catch {
      onStatus('Día de partido: no se ha podido consultar la federación, se reintentará.');
    }
  }

  const start = () => { if (!timer) { poll(); timer = setInterval(poll, EVERY_MS); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
}
