// Lee solo data/partidos.json (local). Nunca llama a la API de la federación.
const TZ = 'Europe/Madrid';
const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el; // todo el texto va por textContent: los datos externos no se interpretan como HTML
}

// ---------- fechas (siempre en hora de Madrid) ----------
function offsetMs(utcMs) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, +x.value]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}
function madridToDate(fecha, hora) {
  const [y, mo, d] = fecha.split('-').map(Number);
  const [hh, mm] = (hora ?? '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return new Date(t);
}
function todayMadrid() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function fechaLarga(fecha) {
  const d = madridToDate(fecha, '12:00');
  return cap(new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d));
}
function fechaCorta(fecha) {
  const d = madridToDate(fecha, '12:00');
  return new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
}
const franja = (m) => (m.franja === 'T' ? 'Tarde' : 'Mañana');

// ---------- piezas ----------
function mapsUrl(p) {
  const dest =
    p.lat != null && p.lng != null
      ? `${p.lat},${p.lng}`
      : [p.nombre, p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

function crest(url) {
  if (!url) return h('span', { class: 'crest--none', 'aria-hidden': 'true' });
  const img = h('img', { class: 'crest', src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: 'crest--none', 'aria-hidden': 'true' })));
  return img;
}

function whenBlock(m) {
  return [
    h('div', { class: 'when' }, fechaLarga(m.fecha), m.hora ? ` · ${m.hora}` : ''),
    m.horaPendiente && h('span', { class: 'badge badge--warn' }, `${franja(m)} (hora por confirmar)`),
  ];
}

let tiempo = {};

function weatherBlock(m) {
  const t = tiempo[m.idMatch];
  if (!t || t.fecha !== m.fecha) return null;
  return h('p', { class: 'extra weather' },
    `${t.icono} ${t.descripcion} · ${t.temperatura} °C · lluvia ${t.probLluvia ?? '–'}% · viento ${t.viento} km/h`,
    t.aproximada && h('small', { class: 'muted' }, ` (a las ${t.horaReferencia}, hora aproximada)`));
}

function resultBadge(m) {
  if (!m.marcador) return null;
  const nuestro = m.local ? m.marcador.local : m.marcador.visitante;
  const rival = m.local ? m.marcador.visitante : m.marcador.local;
  if (nuestro > rival) return h('span', { class: 'badge badge--win' }, 'Victoria');
  return h('span', { class: 'badge' }, nuestro < rival ? 'Derrota' : 'Empate');
}

function renderStanding(rows) {
  if (!rows?.length) return;
  const cols = [
    ['posicion', '#'], ['nombre', 'Equipo'], ['jugados', 'PJ'], ['ganados', 'G'], ['perdidos', 'P'],
    ['puntosFavor', 'PF'], ['puntosContra', 'PC'], ['puntos', 'Pts'],
  ].filter(([k]) => k === 'nombre' || rows.some((r) => r[k] != null)); // oculta columnas que la API no traiga
  const cell = (r, k, i) => (k === 'posicion' ? (r.posicion ?? i + 1) : (r[k] ?? '–'));
  $('standing').replaceChildren(h('table', {},
    h('caption', { class: 'sr-only' }, 'Clasificación del grupo'),
    h('thead', {}, h('tr', {}, cols.map(([, t]) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r, i) =>
      h('tr', { class: r.esNuestro ? 'us' : null }, cols.map(([k]) => h('td', {}, String(cell(r, k, i)))))))));
  $('standing-section').hidden = false;
}

function matchCard(j, { isNext = false, past = false } = {}) {
  const m = j.partido;
  const p = m.pista;
  const score = m.marcador && h('span', { class: 'score' }, `${m.marcador.local} - ${m.marcador.visitante}`);
  const loc = [p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return h('article', { class: `card${isNext ? ' card--next' : ''}${past ? ' card--past' : ''}` },
    h('div', { class: 'card__head' },
      h('span', {}, `Jornada ${j.jornada}`),
      h('span', {}, resultBadge(m), ' ', h('span', { class: 'badge' }, m.local ? 'Local' : 'Visitante'))),
    whenBlock(m),
    isNext && h('div', { class: 'countdown', id: 'countdown', role: 'timer' }),
    h('div', { class: 'match' }, crest(m.rival.escudo), h('span', {}, `${m.local ? 'vs' : '@'} ${m.rival.nombre}`), score),
    h('div', { class: 'venue' }, p.nombre ?? 'Pista por confirmar', loc && h('small', {}, loc)),
    !past && weatherBlock(m),
    p.aparcamiento && h('p', { class: 'extra' }, `🅿️ ${p.aparcamiento}`),
    p.notas && h('p', { class: 'extra' }, `ℹ️ ${p.notas}`),
    p.foto && h('img', { src: p.foto, alt: `Pista ${p.nombre ?? ''}`, loading: 'lazy', style: 'width:100%;border-radius:10px;margin-top:8px' }),
    (p.nombre || p.direccion || p.lat != null) &&
      h('a', { class: 'btn', href: mapsUrl(p), target: '_blank', rel: 'noopener noreferrer' }, 'Cómo llegar'));
}

function otherCard(j) {
  const when = j.fecha ? fechaCorta(j.fecha) : '';
  const text = j.estado === 'descansa' ? 'Descansa' : 'Pendiente de asignar';
  return h('article', { class: 'card card--empty' },
    h('div', { class: 'card__head' }, h('span', {}, `Jornada ${j.jornada}`), h('span', {}, when ? `~ ${when}` : '')),
    h('div', { class: 'when' }, text));
}

// ---------- cuenta atrás ----------
function startCountdown(m) {
  const el = $('countdown');
  if (!el) return;
  const target = madridToDate(m.fecha, m.hora ?? '00:00');
  const tick = () => {
    if (!m.hora) {
      const days = Math.round((madridToDate(m.fecha) - madridToDate(todayMadrid())) / 864e5);
      el.textContent = days <= 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : `Faltan ${days} días`;
      return;
    }
    let s = Math.floor((target - Date.now()) / 1000);
    if (s <= 0) { el.textContent = '¡Es ahora!'; return; }
    const d = Math.floor(s / 86400); s %= 86400;
    const hr = Math.floor(s / 3600); s %= 3600;
    const mi = Math.floor(s / 60);
    el.textContent = d > 0 ? `${d} d ${hr} h ${mi} min` : `${hr} h ${mi} min ${s % 60} s`;
  };
  tick();
  setInterval(tick, m.hora ? 1000 : 60_000);
}

// ---------- main ----------
function isUpcoming(j, today) {
  const m = j.partido;
  return !m.marcador && m.fecha >= today;
}

async function main() {
  let data;
  try {
    const res = await fetch('data/partidos.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    $('list').replaceChildren(h('p', { class: 'muted' }, 'No se han podido cargar los partidos. Inténtalo de nuevo más tarde.'));
    return;
  }

  try {
    const r = await fetch('data/tiempo.json', { cache: 'no-cache' });
    if (r.ok) tiempo = (await r.json()).partidos ?? {};
  } catch {} // la previsión es opcional

  if (data.grupo?.categoria) $('subtitle').textContent = `${data.grupo.categoria.replace(/-/g, ' ').trim()} · ${data.grupo.competicion?.replace(/\./g, ' ').replace(/-/g, ' ').trim() ?? ''}`.replace(/ · $/, '');

  const today = todayMadrid();
  const next = data.jornadas.find((j) => j.estado === 'partido' && isUpcoming(j, today));

  if (next) {
    $('next').replaceChildren(matchCard(next, { isNext: true }));
    $('next-section').hidden = false;
    startCountdown(next.partido);
  }

  renderStanding(data.clasificacion);

  $('list').replaceChildren(
    ...data.jornadas.map((j) =>
      j.estado === 'partido' ? matchCard(j, { past: !isUpcoming(j, today) }) : otherCard(j)),
  );

  if (data.generatedAt) {
    $('updated').textContent = `Datos actualizados: ${new Intl.DateTimeFormat('es-ES', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))}`;
  }
}

// ---------- tema ----------
$('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('tema', next); } catch {}
});

main();
