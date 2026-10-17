// Lee data/partidos.json (y tiempo.json, opcional), ambos locales.
// Solo los días con partidos del grupo consulta además la API de la federación (modo en directo, ver live.js).
import { startLive } from './live.js';

const TZ = 'Europe/Madrid';
const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
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
const fechaCorta = (f) => fmt(f, { weekday: 'short', day: 'numeric', month: 'short' }).replaceAll('.', '');
const franja = (m) => (m.franja === 'T' ? 'Tarde' : 'Mañana');
const MATCH_MIN = 90;

// ---------- estado ----------
let data = null;
let equipo = { id: null, nombre: 'Leioa SBT', escudo: null };
let tiempo = {};
let groupRound = null; // jornada que se ve en "Resultados del grupo"
let timers = [];

// ---------- escudos ----------
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

// ---------- equipaciones ----------
// En castellano y en euskera (la federación recibe ambos: "Urdiña", "Horia"…).
const COLORS = [
  [/blanc|zuri/, '#ffffff'], [/negr|beltz/, '#161616'], [/verde|berde/, '#1f8f4e'], [/marino/, '#1b2a5c'],
  [/celeste/, '#7cc4f0'], [/azul|urdin/, '#1e4fd8'], [/granate|grana/, '#7a1f2b'], [/roj|gorri/, '#d42020'],
  [/amarill|hori/, '#f5cf00'], [/naranja|laranja/, '#f28c00'], [/morad|more|lila|violeta/, '#7b3fb5'],
  [/gris/, '#8a8a8a'], [/rosa|arros/, '#f08cb4'],
];
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function colorOf(name) {
  if (!name) return null;
  if (/^#[0-9a-f]{3,6}$/i.test(name.trim())) return name.trim();
  const p = plain(name);
  return COLORS.find(([re]) => re.test(p))?.[1] ?? null;
}
// Familia de color aproximada para avisar de coincidencias (verde = #008000 = "VERDE").
function family(name) {
  const c = colorOf(name);
  if (!c) return null;
  const hex = c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.15) return max > 0.8 ? 'blanco' : max < 0.25 ? 'negro' : 'gris';
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return ['rojo', 'naranja', 'amarillo', 'verde', 'verde', 'cian', 'azul', 'azul', 'morado', 'rosa', 'rojo', 'rojo'][Math.floor(hue / 30)];
}
function swatch(name) {
  const c = colorOf(name);
  const label = name && !name.startsWith('#') ? cap(name.toLowerCase()) : null;
  return h('span', { class: 'kit__piece', title: name ?? '' },
    c && h('span', { class: 'kit__dot', style: `background:${c}`, 'aria-hidden': 'true' }), label);
}
function kitRow(label, k) {
  if (!k) return null;
  return h('div', { class: 'kit__row' }, h('span', { class: 'kit__who' }, label),
    k.camiseta && swatch(k.camiseta), k.pantalon && h('span', { class: 'kit__sep' }, '/'), k.pantalon && swatch(k.pantalon));
}
function kitBlock(m) {
  const e = m.equipacion;
  if (!e) return null;
  const clash = e.nuestra?.camiseta && e.rival?.camiseta && family(e.nuestra.camiseta) === family(e.rival.camiseta);
  return h('div', { class: 'kit' },
    h('div', { class: 'kit__title' }, '👕 Equipaciones'),
    kitRow(equipo.nombre, e.nuestra),
    kitRow(m.rival.nombre, e.rival),
    clash && h('div', { class: 'kit__warn' }, '⚠️ Camisetas de color parecido: puede que haya que cambiar de equipación.'));
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

const ourScore = (m) => (m.local ? m.marcador.local : m.marcador.visitante);
const theirScore = (m) => (m.local ? m.marcador.visitante : m.marcador.local);
const outcome = (m) => (!m.marcador ? null : ourScore(m) > theirScore(m) ? 'V' : ourScore(m) < theirScore(m) ? 'D' : 'E');

function resultBadge(m) {
  const o = outcome(m);
  if (!o) return null;
  if (o === 'V') return h('span', { class: 'badge badge--win' }, 'Victoria');
  return h('span', { class: 'badge' }, o === 'D' ? 'Derrota' : 'Empate');
}

// En juego: hoy, ya ha empezado, sin resultado y dentro de la duración aproximada.
function isPlayingNow(m) {
  if (m.marcador || !m.hora || m.fecha !== todayMadrid()) return false;
  const start = madridToDate(m.fecha, m.hora).getTime();
  return Date.now() >= start && Date.now() <= start + (MATCH_MIN + 30) * 60_000;
}
const liveBadge = (m) => isPlayingNow(m) && h('span', { class: 'badge badge--live' }, '● En juego');

// Último cambio de fecha/hora/pista en las 3 últimas semanas.
function recentChange(m) {
  const c = m.cambios?.at(-1);
  if (!c || m.marcador) return null;
  return Date.now() - Date.parse(c.detectado) < 21 * 864e5 ? c : null;
}
const CAMPO = { fecha: 'Fecha', hora: 'Hora', pista: 'Pista' };
function changeNote(m) {
  const c = recentChange(m);
  if (!c) return null;
  const val = (v) => (v == null ? 'por confirmar' : c.campo === 'fecha' ? fechaCorta(v) : v);
  return h('div', { class: 'change' }, h('span', { class: 'badge badge--warn' }, 'Cambiado'),
    ` ${CAMPO[c.campo]}: antes ${val(c.antes)}, ahora ${val(c.ahora)}`);
}

// Ida / vuelta contra el mismo rival.
function otherLeg(m) {
  const other = data.jornadas.find((j) => j.partido && j.partido.idMatch !== m.idMatch && j.partido.rival.id === m.rival.id)?.partido;
  if (!other) return null;
  const isIda = other.jornada < m.jornada;
  const label = isIda ? 'Ida' : 'Vuelta';
  if (other.marcador) {
    const o = outcome(other);
    return h('div', { class: 'leg' }, `${label}: ${ourScore(other)}-${theirScore(other)} `,
      h('span', { class: `dot dot--${o}` }, o === 'V' ? 'ganado' : o === 'D' ? 'perdido' : 'empate'),
      ` (J${other.jornada}, ${other.local ? 'en casa' : 'fuera'})`);
  }
  return h('div', { class: 'leg' }, `${label}: J${other.jornada}, ${other.fecha ? fechaCorta(other.fecha) : 'fecha por confirmar'} (${other.local ? 'en casa' : 'fuera'})`);
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
  const today = m.fecha === todayMadrid();

  let countdown = null;
  if (m.marcador) countdown = h('div', { class: 'cd cd--text' }, 'Final ', resultBadge(m));
  else if (isPlayingNow(m)) countdown = h('div', { class: 'cd cd--text cd--live' }, '● En juego');
  else if (m.hora) {
    countdown = h('div', { class: 'cd', role: 'timer' },
      ...[['d', 'días'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']].map(([k, l]) =>
        h('div', { class: 'cd__unit' }, h('b', { id: `cd-${k}` }, '0'), h('span', {}, l))));
  } else countdown = h('div', { class: 'cd cd--text', id: 'cd-text', role: 'timer' });

  return h('article', { class: `next${today ? ' next--today' : ''}` },
    h('div', { class: 'next__label' },
      h('span', {}, `${today ? 'Hoy' : 'Próximo partido'} · J${j.jornada}`),
      h('span', { class: 'badge' }, m.local ? 'En casa' : 'Fuera')),
    changeNote(m),
    h('div', { class: 'vs-row' },
      side(m.equipoLocal, escudoDe(true), us(true)), mid, side(m.equipoVisitante, escudoDe(false), us(false))),
    h('div', { class: 'when-big' }, fechaLarga(m.fecha), m.hora ? ` · ${m.hora}` : '',
      m.convocatoria && h('small', {}, `Convocatoria a las ${m.convocatoria}`),
      m.horaPendiente && h('small', {}, `${franja(m)} · hora por confirmar`)),
    countdown,
    otherLeg(m),
    kitBlock(m),
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
  return h('article', { class: `card${past ? ' card--past' : ''}${isPlayingNow(m) ? ' card--live' : ''}` },
    dateBox(m.fecha),
    h('div', {},
      h('div', { class: 'card__top' },
        h('span', {}, `Jornada ${j.jornada}`),
        h('span', {}, liveBadge(m), resultBadge(m), recentChange(m) && h('span', { class: 'badge badge--warn' }, 'Cambiado'),
          ' ', h('span', { class: 'badge' }, m.local ? 'Local' : 'Visitante'))),
      h('div', { class: 'opp' },
        crest(m.rival.escudo, m.rival.nombre, 'md'),
        h('span', { class: 'opp__name' }, `${m.local ? 'vs' : '@'} ${m.rival.nombre}`),
        m.marcador && h('span', { class: 'score' }, `${m.marcador.local} - ${m.marcador.visitante}`)),
      h('div', { class: 'card__time' }, m.hora ?? `${franja(m)} · hora por confirmar`,
        m.convocatoria && !past && h('small', {}, ` · convocatoria ${m.convocatoria}`)),
      h('div', { class: 'venue' }, [p.nombre ?? 'Pista por confirmar', p.localidad].filter(Boolean).join(' · ')),
      !past && changeNote(m),
      !past && otherLeg(m),
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

// ---------- resumen de la temporada ----------
function firstMatchText() {
  const f = data.jornadas.find((j) => j.partido?.fecha)?.partido.fecha;
  return f ? `Primer partido: ${fechaLarga(f).toLowerCase()}.` : '';
}

function renderSummary() {
  const played = data.jornadas.filter((j) => j.partido?.marcador).map((j) => j.partido);
  if (!played.length) {
    $('summary').replaceChildren(h('p', { class: 'muted empty' }, `Aún no se ha jugado ningún partido. ${firstMatchText()}`));
    $('summary-section').hidden = false;
    return;
  }
  const v = played.filter((m) => outcome(m) === 'V').length;
  const d = played.filter((m) => outcome(m) === 'D').length;
  const pf = played.reduce((s, m) => s + ourScore(m), 0);
  const pc = played.reduce((s, m) => s + theirScore(m), 0);
  const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', {}, l));
  $('summary').replaceChildren(
    h('div', { class: 'stats' }, stat(played.length, 'jugados'), stat(v, 'victorias'), stat(d, 'derrotas'),
      stat(`${pf}-${pc}`, 'puntos'), stat(Math.round(pf / played.length), 'media a favor')),
    h('div', { class: 'streak' }, h('span', { class: 'muted' }, 'Últimos: '),
      played.slice(-5).map((m) => h('span', { class: `dot dot--${outcome(m)}`, title: `J${m.jornada} vs ${m.rival.nombre}: ${ourScore(m)}-${theirScore(m)}` }, outcome(m)))));
  $('summary-section').hidden = false;
}

// ---------- clasificación ----------
function renderStanding(rows) {
  if (!rows?.length) {
    $('standing').replaceChildren(h('p', { class: 'muted empty' }, `Aparecerá cuando haya resultados. ${firstMatchText()}`));
    $('standing-note').textContent = '';
    $('standing-section').hidden = false;
    return;
  }
  const anyPlayed = rows.some((r) => r.jugados > 0);
  const dif = (r) => (r.puntosFavor != null && r.puntosContra != null ? r.puntosFavor - r.puntosContra : null);
  const avg = (v, r) => (v != null && r.jugados ? (v / r.jugados).toFixed(1).replace('.', ',') : null);
  // [clave, cabecera, explicación, valor]; E y NP solo si alguien tiene alguno.
  const cols = [
    ['posicion', '#', 'Posición', (r) => r.posicion],
    ['nombre', 'Equipo', null, null],
    ['jugados', 'PJ', 'Partidos jugados', (r) => r.jugados],
    ['ganados', 'G', 'Ganados', (r) => r.ganados],
    ['perdidos', 'P', 'Perdidos', (r) => r.perdidos],
    ['empatados', 'E', 'Empatados', (r) => r.empatados, 'any'],
    ['noPresentados', 'NP', 'No presentados', (r) => r.noPresentados, 'any'],
    ['puntosFavor', 'PF', 'Puntos a favor', (r) => r.puntosFavor],
    ['puntosContra', 'PC', 'Puntos en contra', (r) => r.puntosContra],
    ['dif', 'DIF', 'Diferencia de puntos (average)', (r) => { const d = dif(r); return d == null ? null : d > 0 ? `+${d}` : String(d); }],
    ['mediaFavor', 'M+', 'Media de puntos a favor por partido', (r) => avg(r.puntosFavor, r)],
    ['mediaContra', 'M−', 'Media de puntos en contra por partido', (r) => avg(r.puntosContra, r)],
    ['puntos', 'Pts', 'Puntos de clasificación', (r) => r.puntos],
    ['forma', 'Últimos', 'Últimos 5 partidos (V victoria, D derrota)', null],
  ].filter(([k, , , get, mode]) => {
    if (k === 'nombre' || k === 'forma') return true;
    if (mode === 'any') return rows.some((r) => get(r) > 0);
    return rows.some((r) => get(r) != null); // oculta columnas que la API no traiga
  });

  const form = (r) => {
    const last = (data.grupoPartidos ?? [])
      .filter((m) => m.marcador && (m.local.id === r.id || m.visitante.id === r.id))
      .sort((a, b) => a.jornada - b.jornada).slice(-5);
    if (!last.length) return '–';
    return h('span', { class: 'form' }, last.map((m) => {
      const [pf, pc] = m.local.id === r.id ? [m.marcador.local, m.marcador.visitante] : [m.marcador.visitante, m.marcador.local];
      const o = pf > pc ? 'V' : pf < pc ? 'D' : 'E';
      const rival = m.local.id === r.id ? m.visitante.nombre : m.local.nombre;
      return h('span', { class: `dot dot--sm dot--${o}`, title: `J${m.jornada} vs ${rival}: ${pf}-${pc}` }, o);
    }));
  };
  const cell = (r, [k, , , get]) => {
    if (k === 'nombre') return h('div', { class: 'team-cell' }, crest(r.escudo, r.nombre ?? '?', 'sm'), h('span', {}, r.nombre ?? '–'));
    if (k === 'forma') return form(r);
    const v = get(r);
    return v == null ? '–' : String(v);
  };
  $('standing').replaceChildren(h('table', { class: 'standing' },
    h('caption', { class: 'sr-only' }, 'Clasificación del grupo'),
    h('thead', {}, h('tr', {}, cols.map(([k, t, title]) => h('th', { scope: 'col', title, class: `c-${k}` }, t)))),
    h('tbody', {}, rows.map((r) =>
      h('tr', { class: r.esNuestro ? 'us' : null }, cols.map((c) => h('td', { class: `c-${c[0]}` }, cell(r, c))))))));

  const legend = cols.filter(([, , title]) => title && title !== 'Posición').map(([, t, title]) => `${t}: ${title.charAt(0).toLowerCase()}${title.slice(1)}`).join(' · ');
  $('standing-note').textContent = [
    !anyPlayed ? `Todavía no se ha jugado ningún partido. ${firstMatchText()}` : null,
    anyPlayed && data.clasificacionCalculada
      ? 'Calculada con los resultados publicados (2 puntos por victoria, 1 por derrota; desempate por diferencia de puntos); la oficial puede variar.'
      : null,
    legend,
  ].filter(Boolean).join(' ');
  $('standing-section').hidden = false;
}

// ---------- resultados del grupo ----------
function defaultRound(matches) {
  const today = todayMadrid();
  const todays = matches.find((m) => m.fecha === today);
  if (todays) return todays.jornada;
  const lastPlayed = matches.filter((m) => m.marcador).at(-1);
  if (lastPlayed) return lastPlayed.jornada;
  return matches.find((m) => m.fecha && m.fecha >= today)?.jornada ?? matches[0]?.jornada ?? null;
}

function groupRow(m) {
  const ours = m.local.id === equipo.id || m.visitante.id === equipo.id;
  const team = (t, sc) => h('div', { class: `g-team${t.id === equipo.id ? ' g-team--us' : ''}` },
    crest(t.escudo, t.nombre, 'sm'), h('span', { class: 'g-name' }, t.nombre), h('b', { class: 'g-score' }, sc ?? ''));
  const playing = isPlayingNow({ ...m, marcador: m.marcador });
  return h('li', { class: `g-match${ours ? ' g-match--us' : ''}` },
    h('div', { class: 'g-meta' },
      m.fecha ? `${fechaCorta(m.fecha)}${m.hora ? ` · ${m.hora}` : ''}` : 'Fecha por confirmar',
      playing && h('span', { class: 'badge badge--live' }, '● En juego'),
      m.marcador && h('span', { class: 'badge' }, 'Final')),
    team(m.local, m.marcador?.local), team(m.visitante, m.marcador?.visitante));
}

function renderGroup() {
  const all = data.grupoPartidos ?? [];
  if (!all.length) { $('group-section').hidden = true; return; }
  const rounds = [...new Set(all.map((m) => m.jornada))].sort((a, b) => a - b);
  if (groupRound == null || !rounds.includes(groupRound)) groupRound = defaultRound(all);
  const idx = rounds.indexOf(groupRound);
  // Leioa primero; el resto por hora.
  const list = all.filter((m) => m.jornada === groupRound).sort((a, b) =>
    (b.local.id === equipo.id || b.visitante.id === equipo.id) - (a.local.id === equipo.id || a.visitante.id === equipo.id) ||
    `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
  const rest = data.jornadas.find((j) => j.jornada === groupRound)?.estado === 'descansa';
  const go = (d) => () => { groupRound = rounds[idx + d]; renderGroup(); };
  $('group').replaceChildren(...h('div', {},
    h('div', { class: 'g-nav' },
      h('button', { class: 'g-btn', type: 'button', disabled: idx <= 0 ? 'disabled' : null, onclick: go(-1), 'aria-label': 'Jornada anterior' }, '‹'),
      h('span', {}, `Jornada ${groupRound}`),
      h('button', { class: 'g-btn', type: 'button', disabled: idx >= rounds.length - 1 ? 'disabled' : null, onclick: go(1), 'aria-label': 'Jornada siguiente' }, '›')),
    rest && h('p', { class: 'muted g-rest' }, `${equipo.nombre} descansa esta jornada.`),
    h('ul', { class: 'g-list' }, list.map(groupRow))).childNodes);
  $('group-section').hidden = false;
}

// ---------- cuenta atrás ----------
function startCountdown(m) {
  if (m.marcador || isPlayingNow(m)) return;
  if (!m.hora) {
    const el = $('cd-text');
    const tick = () => {
      const days = Math.round((madridToDate(m.fecha) - madridToDate(todayMadrid())) / 864e5);
      el.textContent = days <= 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : `Faltan ${days} días`;
    };
    tick();
    timers.push(setInterval(tick, 60_000));
    return;
  }
  const target = madridToDate(m.fecha, m.hora);
  const set = (k, v) => { const el = $(`cd-${k}`); if (el) el.textContent = String(v).padStart(2, '0'); };
  const tick = () => {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    if (s === 0) { render(); return; } // empieza el partido: pasa a "En juego"
    set('d', Math.floor(s / 86400)); s %= 86400;
    set('h', Math.floor(s / 3600)); s %= 3600;
    set('m', Math.floor(s / 60));
    set('s', s % 60);
  };
  tick();
  timers.push(setInterval(tick, 1000));
}

// ---------- render ----------
// Un partido sigue destacado todo el día en que se juega, aunque ya tenga resultado.
const isUpcoming = (j, today) => j.partido.fecha >= today && (!j.partido.marcador || j.partido.fecha === today);

function render() {
  timers.forEach(clearInterval);
  timers = [];
  const today = todayMadrid();
  const next = data.jornadas.find((j) => j.estado === 'partido' && isUpcoming(j, today));
  if (next) {
    $('next').replaceChildren(nextCard(next));
    $('next-section').hidden = false;
    document.querySelector('.main').style.marginTop = '';
    startCountdown(next.partido);
  } else {
    $('next-section').hidden = true;
    document.querySelector('.main').style.marginTop = '0';
  }

  renderSummary();
  renderGroup();
  renderStanding(data.clasificacion);

  $('list').replaceChildren(
    ...data.jornadas.map((j) =>
      j.estado === 'partido' ? matchCard(j, { past: !isUpcoming(j, today) }) : otherCard(j)),
  );
}

// Aplica marcadores llegados en directo (idMatch -> {local, visitante}) y vuelve a pintar.
function applyLive(scores) {
  let changed = false;
  for (const m of data.grupoPartidos ?? []) {
    const s = scores.get(m.idMatch);
    if (s && JSON.stringify(s) !== JSON.stringify(m.marcador)) { m.marcador = s; changed = true; }
  }
  for (const j of data.jornadas) {
    const s = j.partido && scores.get(j.partido.idMatch);
    if (s && JSON.stringify(s) !== JSON.stringify(j.partido.marcador)) { j.partido.marcador = s; changed = true; }
  }
  if (changed) render();
}

async function main() {
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
    const mark = $('team-mark');
    mark.src = equipo.escudo;
    mark.hidden = false;
  }
  const y = Number(data.grupo?.temporada);
  if (y) $('subtitle').textContent = `Minibasket masculino A · Temporada ${y}/${String((y + 1) % 100).padStart(2, '0')}`;

  render();

  if (data.generatedAt) {
    $('updated').textContent = `Datos actualizados: ${new Intl.DateTimeFormat('es-ES', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))}`;
  }

  const today = todayMadrid();
  if ((data.grupoPartidos ?? []).some((m) => m.fecha === today)) {
    startLive({
      onScores: applyLive,
      onStatus: (text) => { $('live-status').textContent = text; $('live-status').hidden = !text; },
    });
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

// ---------- app instalable ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

main();
