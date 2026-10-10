// Lee solo data/partidos.json (y tiempo.json, opcional), ambos locales.
// Nunca llama a la API de la federación ni a terceros.
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
  return el; // todo el texto va por nodos de texto: los datos externos no se interpretan como HTML
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
const fmt = (fecha, opts) => new Intl.DateTimeFormat('es-ES', { timeZone: TZ, ...opts }).format(madridToDate(fecha, '12:00'));
const fechaLarga = (f) => cap(fmt(f, { weekday: 'long', day: 'numeric', month: 'long' }));
const franja = (m) => (m.franja === 'T' ? 'Tarde' : 'Mañana');

// ---------- escudos ----------
let equipo = { nombre: 'Leioa SBT', escudo: null };
let tiempo = {};

function hueOf(s) {
  let x = 0;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}
function initials(name) {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/)
    .filter((x) => x.length > 1 && !/^(club|cd|ke|ad|de|del|la|el)$/i.test(x));
  return ((w[0]?.[0] ?? '?') + (w[1]?.[0] ?? '')).toUpperCase();
}
// Escudo local; si no existe o falla, círculo con iniciales y color estable por nombre.
function crest(url, name, size = 'md') {
  const fallback = () =>
    h('span', { class: `crest crest--${size} crest--fallback`, style: `--h:${hueOf(name)}`, 'aria-hidden': 'true' }, initials(name));
  if (!url) return fallback();
  const img = h('img', { class: `crest crest--${size}`, src: url, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

// ---------- piezas ----------
function mapsUrl(p) {
  const dest =
    p.lat != null && p.lng != null
      ? `${p.lat},${p.lng}`
      : [p.nombre, p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
const hasPlace = (p) => p.nombre || p.direccion || p.lat != null;
const direccion = (p) => [p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')].filter(Boolean).join(', ');

function resultBadge(m) {
  if (!m.marcador) return null;
  const nuestro = m.local ? m.marcador.local : m.marcador.visitante;
  const rival = m.local ? m.marcador.visitante : m.marcador.local;
  if (nuestro > rival) return h('span', { class: 'badge badge--win' }, 'Victoria');
  return h('span', { class: 'badge' }, nuestro < rival ? 'Derrota' : 'Empate');
}

function weatherChip(m) {
  const t = tiempo[m.idMatch];
  if (!t || t.fecha !== m.fecha) return null;
  const aprox = t.aproximada ? ` (hacia las ${t.horaReferencia})` : '';
  return h('span', { class: 'chip' },
    `${t.icono} ${t.descripcion} · ${t.temperatura} °C · lluvia ${t.probLluvia ?? '–'}% · viento ${t.viento} km/h${aprox}`);
}

function extras(m, { weather }) {
  const p = m.pista;
  const chips = [weather && weatherChip(m), p.aparcamiento && h('span', { class: 'chip' }, `🅿️ ${p.aparcamiento}`),
    p.notas && h('span', { class: 'chip' }, `ℹ️ ${p.notas}`)].filter(Boolean);
  return chips.length ? h('div', { class: 'chips' }, chips) : null;
}

function mapsButton(p, cls) {
  return hasPlace(p) && h('a', { class: cls, href: mapsUrl(p), target: '_blank', rel: 'noopener noreferrer' }, '📍 Cómo llegar');
}

function side(name, escudo, us) {
  return h('div', { class: `side${us ? ' side--us' : ''}` }, crest(escudo, name, 'xl'), h('span', { class: 'side__name' }, name));
}

// ---------- tarjeta del próximo partido ----------
function nextCard(j) {
  const m = j.partido;
  const p = m.pista;
  const us = (local) => (m.local ? local : !local);
  const escudoDe = (isLocalSide) => (us(isLocalSide) ? equipo.escudo : m.rival.escudo);
  const mid = m.marcador
    ? h('span', { class: 'vs-score' }, `${m.marcador.local} - ${m.marcador.visitante}`)
    : h('span', { class: 'vs-badge' }, 'VS');

  const countdown = m.hora
    ? h('div', { class: 'cd', role: 'timer' },
        ...[['d', 'días'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']].map(([k, l]) =>
          h('div', { class: 'cd__unit' }, h('b', { id: `cd-${k}` }, '0'), h('span', {}, l))))
    : h('div', { class: 'cd cd--text', id: 'cd-text', role: 'timer' });

  return h('article', { class: 'next' },
    h('div', { class: 'next__label' }, h('span', {}, `Próximo partido · J${j.jornada}`), h('span', { class: 'badge' }, m.local ? 'En casa' : 'Fuera')),
    h('div', { class: 'vs-row' },
      side(m.equipoLocal, escudoDe(true), us(true)), mid, side(m.equipoVisitante, escudoDe(false), us(false))),
    h('div', { class: 'when-big' }, fechaLarga(m.fecha), m.hora ? ` · ${m.hora}` : '',
      m.horaPendiente && h('small', {}, `${franja(m)} · hora por confirmar`)),
    countdown,
    h('div', { class: 'place' },
      h('div', { class: 'place__name' }, p.nombre ?? 'Pista por confirmar'),
      direccion(p) && h('small', {}, direccion(p)),
      extras(m, { weather: true }),
      p.foto && h('img', { class: 'photo', src: p.foto, alt: `Pista ${p.nombre ?? ''}`, loading: 'lazy' }),
      mapsButton(p, 'btn')));
}

// ---------- tarjetas de la lista ----------
function dateBox(fecha) {
  if (!fecha) return h('div', { class: 'datebox' }, h('span', { class: 'day' }, '–'));
  return h('div', { class: 'datebox' },
    h('span', { class: 'dow' }, fmt(fecha, { weekday: 'short' }).replace('.', '')),
    h('span', { class: 'day' }, fmt(fecha, { day: 'numeric' })),
    h('span', { class: 'mon' }, fmt(fecha, { month: 'short' }).replace('.', '')));
}

function matchCard(j, { past }) {
  const m = j.partido;
  const p = m.pista;
  return h('article', { class: `card${past ? ' card--past' : ''}` },
    dateBox(m.fecha),
    h('div', {},
      h('div', { class: 'card__top' },
        h('span', {}, `Jornada ${j.jornada}`),
        h('span', {}, resultBadge(m), ' ', h('span', { class: 'badge' }, m.local ? 'Local' : 'Visitante'))),
      h('div', { class: 'opp' },
        crest(m.rival.escudo, m.rival.nombre, 'md'),
        h('span', { class: 'opp__name' }, `${m.local ? 'vs' : '@'} ${m.rival.nombre}`),
        m.marcador && h('span', { class: 'score' }, `${m.marcador.local} - ${m.marcador.visitante}`)),
      h('div', { class: 'card__time' }, m.hora ?? `${franja(m)} · hora por confirmar`),
      h('div', { class: 'venue' }, [p.nombre ?? 'Pista por confirmar', p.localidad].filter(Boolean).join(' · ')),
      !past && extras(m, { weather: true }),
      !past && mapsButton(p, 'btn btn--sm')));
}

function otherCard(j) {
  return h('article', { class: 'card card--empty' },
    dateBox(j.fecha),
    h('div', {},
      h('div', { class: 'card__top' }, h('span', {}, `Jornada ${j.jornada}`)),
      h('div', { class: 'state' }, j.estado === 'descansa' ? 'Descansa' : 'Pendiente de asignar')));
}

// ---------- clasificación ----------
function renderStanding(rows) {
  if (!rows?.length) return;
  const cols = [
    ['posicion', '#'], ['nombre', 'Equipo'], ['jugados', 'PJ'], ['ganados', 'G'], ['perdidos', 'P'],
    ['puntosFavor', 'PF'], ['puntosContra', 'PC'], ['puntos', 'Pts'],
  ].filter(([k]) => k === 'nombre' || rows.some((r) => r[k] != null)); // oculta columnas que la API no traiga
  const cell = (r, k, i) => {
    if (k === 'posicion') return String(r.posicion ?? i + 1);
    if (k === 'nombre') return h('div', { class: 'team-cell' }, crest(r.escudo, r.nombre ?? '?', 'sm'), h('span', {}, r.nombre ?? '–'));
    return String(r[k] ?? '–');
  };
  $('standing').replaceChildren(h('table', {},
    h('caption', { class: 'sr-only' }, 'Clasificación del grupo'),
    h('thead', {}, h('tr', {}, cols.map(([, t]) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r, i) =>
      h('tr', { class: r.esNuestro ? 'us' : null }, cols.map(([k]) => h('td', {}, cell(r, k, i))))))));
  $('standing-section').hidden = false;
}

// ---------- cuenta atrás ----------
function startCountdown(m) {
  if (!m.hora) {
    const el = $('cd-text');
    const tick = () => {
      const days = Math.round((madridToDate(m.fecha) - madridToDate(todayMadrid())) / 864e5);
      el.textContent = days <= 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : `Faltan ${days} días`;
    };
    tick();
    setInterval(tick, 60_000);
    return;
  }
  const target = madridToDate(m.fecha, m.hora);
  const set = (k, v) => { $(`cd-${k}`).textContent = String(v).padStart(2, '0'); };
  const tick = () => {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    set('d', Math.floor(s / 86400)); s %= 86400;
    set('h', Math.floor(s / 3600)); s %= 3600;
    set('m', Math.floor(s / 60));
    set('s', s % 60);
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- main ----------
const isUpcoming = (j, today) => !j.partido.marcador && j.partido.fecha >= today;

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

  equipo = data.equipo ?? equipo;
  if (equipo.escudo) {
    const img = $('team-crest');
    img.src = equipo.escudo;
    img.hidden = false;
  }
  const y = Number(data.grupo?.temporada);
  if (y) $('subtitle').textContent = `Temporada ${y}/${String((y + 1) % 100).padStart(2, '0')}`;

  const today = todayMadrid();
  const next = data.jornadas.find((j) => j.estado === 'partido' && isUpcoming(j, today));
  if (next) {
    $('next').replaceChildren(nextCard(next));
    $('next-section').hidden = false;
    startCountdown(next.partido);
  } else {
    document.querySelector('.main').style.marginTop = '0';
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
