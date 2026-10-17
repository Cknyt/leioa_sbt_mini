// Descarga el JSON de la federación, lo normaliza y escribe public/data/partidos.json.
// Una sola petición: getAllGamesByGrupWithMatchRecords trae la temporada entera del grupo
// (la URL de FVB_URL, .../resultats/<grupo>, solo trae dos jornadas). Si algo falla, el partidos.json anterior se conserva.
// La URL (FVB_URL) nunca se imprime: contiene un token.
// Del acta (matchRecord) y de las fichas de equipo NO se guarda nada: incluyen datos de los jugadores (menores).
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'partidos.json');
const SEASONS_DIR = join(ROOT, 'public', 'data', 'temporadas');
const LIVE_CONFIG = join(ROOT, 'public', 'data', 'directo.json'); // no se sube a git (ver .gitignore)
const PISTAS = join(ROOT, 'data', 'pistas.json');
const CRESTS_DIR = join(ROOT, 'public', 'img', 'escudos');

const TEAM_ID = '17087';
const TEAM_NAME = 'Leioa SBT';
const CONVOCATORIA_MIN = 45; // la convocatoria es 45 minutos antes del partido
const USER_AGENT = 'leioa-sbt-mini-web/0.1 (web de familias; contacto: info@experienciatek.com)';

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  console.error('  Se conserva el partidos.json anterior.');
  process.exit(1);
};

// ---------- descarga ----------
async function download(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // No se imprime err.message completo por si incluyera la URL.
    throw new Error(`no se pudo conectar (${err.cause?.code ?? err.name})`);
  }
  if (!res.ok) throw new Error(`la federación respondió HTTP ${res.status}`);
  const body = (await res.text()).trim();
  // La API devuelve el JSON codificado en base64 (con content-type text/html).
  // Se acepta también JSON plano por si lo cambian.
  const text = body.startsWith('{') ? body : Buffer.from(body, 'base64').toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('la respuesta no es JSON válido (ni JSON plano ni base64)');
  }
}

// .../FCBQWeb/resultats/2924 -> .../FCBQWeb/getAllGamesByGrupWithMatchRecords/2924
function seasonUrl(url) {
  const m = url.match(/^(.*\/FCBQWeb\/)(?:resultats|getAllGamesByGrupWithMatchRecords)\/(\d+)\/?$/);
  if (!m) throw new Error('FVB_URL no tiene la forma .../FCBQWeb/resultats/<grupo>');
  return `${m[1]}getAllGamesByGrupWithMatchRecords/${m[2]}`;
}

// ---------- normalización ----------
const clean = (v) => (v === undefined || v === null || v === '' ? null : v);
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const matchesOf = (round) => Object.values(round?.matches ?? {});

function minusMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m - min + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function when(m) {
  const [fecha, horaRaw = ''] = String(m.matchDay).split(' ');
  const hhmm = horaRaw.slice(0, 5);
  // 00:00 y 23:59 son marcadores de "hora por confirmar".
  const horaPendiente = !hhmm || hhmm === '00:00' || hhmm === '23:59';
  return { fecha, hora: horaPendiente ? null : hhmm, horaPendiente };
}

const score = (m) =>
  m.localScore !== null && m.localScore !== undefined && m.visitorScore !== null && m.visitorScore !== undefined
    ? { local: Number(m.localScore), visitante: Number(m.visitorScore) }
    : null;

const kit = (shirt, pants) => (clean(shirt) || clean(pants) ? { camiseta: clean(shirt), pantalon: clean(pants) } : null);

function normalizeMatch(m, pistas, crests) {
  const { fecha, hora, horaPendiente } = when(m);
  const local = String(m.idLocalTeam) === TEAM_ID;

  const pista = pistas[m.idField] ?? pistas[m.nameField] ?? {};
  const apiLat = num(m.latitudeField);
  const apiLng = num(m.longitudeField);
  const lat = apiLat ?? num(pista.lat);
  const lng = apiLng ?? num(pista.lng);

  const kitLocal = kit(m.shirtColorLocalTeam, m.pantsColorLocalTeam);
  const kitVisitor = kit(m.shirtColorVisitorTeam, m.pantsColorVisitorTeam);
  return {
    idMatch: String(m.idMatch),
    jornada: Number(m.numMatchDay),
    fecha,
    hora,
    convocatoria: hora ? minusMinutes(hora, CONVOCATORIA_MIN) : null,
    horaPendiente,
    franja: m.dayTime === 'T' ? 'T' : 'M', // M = mañana, T = tarde
    local,
    rival: {
      id: String(local ? m.idVisitorTeam : m.idLocalTeam),
      nombre: local ? m.nameVisitorTeam : m.nameLocalTeam,
      escudo: crests[String(local ? m.idVisitorTeam : m.idLocalTeam)] ?? null,
    },
    equipoLocal: m.nameLocalTeam,
    equipoVisitante: m.nameVisitorTeam,
    equipacion: kitLocal || kitVisitor
      ? { nuestra: local ? kitLocal : kitVisitor, rival: local ? kitVisitor : kitLocal }
      : null,
    pista: {
      id: clean(m.idField),
      nombre: clean(m.nameField),
      direccion: clean(m.adressField),
      codigoPostal: clean(m.postalCodeField),
      localidad: clean(m.nameTown),
      lat,
      lng,
      aparcamiento: clean(pista.aparcamiento),
      notas: clean(pista.notas),
      foto: clean(pista.foto),
    },
    marcador: score(m),
    cambios: [],
  };
}

// Partido de otro equipo del grupo: solo lo necesario para resultados y clasificación.
function groupMatch(m, crests) {
  const { fecha, hora } = when(m);
  const team = (id, nombre) => ({ id: String(id), nombre, escudo: crests[String(id)] ?? null });
  return {
    idMatch: String(m.idMatch),
    jornada: Number(m.numMatchDay),
    fecha,
    hora,
    local: team(m.idLocalTeam, m.nameLocalTeam),
    visitante: team(m.idVisitorTeam, m.nameVisitorTeam),
    marcador: score(m),
  };
}

// Formato real del standing de la API (visto en otros grupos con partidos jugados).
const STANDING_FIELDS = {
  id: ['idTeam'],
  nombre: ['teamName', 'nameTeam'],
  posicion: ['position'],
  jugados: ['matchPlayed'],
  ganados: ['matchWin'],
  perdidos: ['matchLost'],
  empatados: ['matchTie'],
  puntosFavor: ['matchScoreFavour'],
  puntosContra: ['matchScoreAgainst'],
  puntos: ['standingScore'],
};

function normalizeStanding(standing) {
  const rows = Array.isArray(standing) ? standing : Object.values(standing ?? {});
  if (rows.length === 0) return [];
  const out = rows.map((row) => {
    const o = {};
    for (const [key, names] of Object.entries(STANDING_FIELDS)) {
      const found = names.find((n) => row?.[n] !== undefined && row[n] !== null && row[n] !== '');
      const v = found ? row[found] : null;
      o[key] = key === 'nombre' || key === 'id' ? (v === null ? null : String(v)) : num(v);
    }
    o.esNuestro = o.id === TEAM_ID;
    return o;
  });
  if (out.every((r) => r.nombre === null)) {
    // Aviso útil para ajustar el mapeo si la API cambia (solo nombres de campo).
    console.warn(`! standing no reconocido; campos recibidos: ${Object.keys(rows[0] ?? {}).join(', ')}`);
  }
  return out.sort((a, b) => (a.posicion ?? 99) - (b.posicion ?? 99));
}

// Si la API aún no publica clasificación pero ya hay resultados, se calcula (2 pts victoria, 1 derrota).
function computeStanding(matches) {
  const played = matches.filter((m) => m.marcador);
  if (played.length === 0) return [];
  const t = new Map();
  const row = (team) => {
    if (!t.has(team.id)) {
      t.set(team.id, { id: team.id, nombre: team.nombre, posicion: null, jugados: 0, ganados: 0, perdidos: 0,
        empatados: 0, puntosFavor: 0, puntosContra: 0, puntos: 0, esNuestro: team.id === TEAM_ID });
    }
    return t.get(team.id);
  };
  for (const m of matches) { row(m.local); row(m.visitante); }
  for (const m of played) {
    const sides = [[row(m.local), m.marcador.local, m.marcador.visitante], [row(m.visitante), m.marcador.visitante, m.marcador.local]];
    for (const [r, pf, pc] of sides) {
      r.jugados++;
      r.puntosFavor += pf;
      r.puntosContra += pc;
      if (pf > pc) { r.ganados++; r.puntos += 2; } else if (pf < pc) { r.perdidos++; r.puntos += 1; } else { r.empatados++; r.puntos += 1; }
    }
  }
  const out = [...t.values()].sort((a, b) =>
    b.puntos - a.puntos || (b.puntosFavor - b.puntosContra) - (a.puntosFavor - a.puntosContra) || b.puntosFavor - a.puntosFavor);
  out.forEach((r, i) => { r.posicion = i + 1; });
  return out;
}

function normalize(raw, pistas, crests) {
  if (raw?.result !== 'OK' || !raw.messageData?.rounds) {
    throw new Error('formato inesperado: falta result "OK" o messageData.rounds');
  }
  const md = raw.messageData;
  const restIds = new Set(
    Object.entries(md.rest ?? {})
      .filter(([, ids]) => Object.values(ids ?? {}).map(String).includes(TEAM_ID))
      .map(([r]) => Number(r)),
  );

  const rounds = Object.entries(md.rounds)
    .map(([k, round]) => ({ n: Number(k), round }))
    .sort((a, b) => a.n - b.n);

  const jornadas = rounds.map(({ n, round }) => {
    const matches = matchesOf(round);
    const base = { jornada: n, fecha: round.date ?? null };
    const ours = matches.find(
      (m) => String(m.idLocalTeam) === TEAM_ID || String(m.idVisitorTeam) === TEAM_ID,
    );
    if (ours) return { ...base, estado: 'partido', partido: normalizeMatch(ours, pistas, crests) };
    // Jornada asignada en la que no aparecemos, o la API lo indica: descansamos.
    if (matches.length > 0 || restIds.has(n)) return { ...base, estado: 'descansa' };
    return { ...base, estado: 'pendiente' };
  });

  const grupoPartidos = rounds.flatMap(({ round }) => matchesOf(round).map((m) => groupMatch(m, crests)));
  const apiStanding = normalizeStanding(md.standing);
  const clasificacion = apiStanding.length ? apiStanding : computeStanding(grupoPartidos);

  return {
    generatedAt: new Date().toISOString(),
    equipo: { id: TEAM_ID, nombre: TEAM_NAME, escudo: crests[TEAM_ID] ?? null },
    grupo: {
      id: clean(md.group?.idGroup),
      nombre: md.group?.nameGroup ?? null,
      competicion: md.group?.competitionName ?? null,
      categoria: md.group?.categoryName ?? null,
      temporada: md.group?.season ?? null,
    },
    jornadaActual: Number(md.lastRound) || null,
    totalJornadas: Number(md.totalRounds) || jornadas.length,
    jornadas,
    grupoPartidos,
    clasificacion: clasificacion.map((r) => ({ ...r, escudo: crests[r.id] ?? null })),
    clasificacionCalculada: !apiStanding.length && clasificacion.length > 0,
  };
}

// ---------- cambios de fecha, hora o pista ----------
// Se compara con el partidos.json anterior; los cambios se acumulan (el workflow sube el JSON a git).
const TRACKED = [
  ['fecha', (m) => m.fecha],
  ['hora', (m) => m.hora],
  ['pista', (m) => m.pista?.nombre ?? null],
];

function trackChanges(data, previous) {
  const prevById = new Map(
    (previous?.jornadas ?? []).filter((j) => j.partido).map((j) => [j.partido.idMatch, j.partido]),
  );
  const now = data.generatedAt;
  let n = 0;
  for (const j of data.jornadas) {
    const m = j.partido;
    if (!m) continue;
    const before = prevById.get(m.idMatch);
    if (!before) continue;
    m.cambios = [...(before.cambios ?? [])];
    if (m.marcador) continue; // los jugados ya no cambian de horario
    for (const [campo, get] of TRACKED) {
      const antes = get(before) ?? null;
      const ahora = get(m) ?? null;
      if (antes !== ahora) {
        m.cambios.push({ campo, antes, ahora, detectado: now });
        n++;
      }
    }
  }
  if (n) console.log(`! ${n} cambio(s) de fecha/hora/pista detectados.`);
}

// ---------- escudos ----------
// Se descargan una vez a public/img/escudos/ (así el navegador no pide nada al CDN de la federación).
// Solo se baja un escudo si es nuevo o ha cambiado su URL (manifest.json). Un fallo no aborta la ejecución.
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_CREST_BYTES = 1_000_000;

async function syncCrests(raw) {
  const sources = new Map(); // idTeam -> url
  for (const round of Object.values(raw.messageData?.rounds ?? {})) {
    for (const m of matchesOf(round)) {
      const local = clean(m.logoLocal);
      const visitor = clean(m.logoVisitant ?? m.logoVisitante);
      if (local) sources.set(String(m.idLocalTeam), local);
      if (visitor) sources.set(String(m.idVisitorTeam), visitor);
    }
  }
  await mkdir(CRESTS_DIR, { recursive: true });
  const manifestPath = join(CRESTS_DIR, 'manifest.json');
  const manifest = await readFile(manifestPath, 'utf8').then(JSON.parse, () => ({}));
  const result = {};
  let changed = false;

  for (const [id, url] of sources) {
    const known = manifest[id];
    if (known?.url === url) {
      result[id] = known.file;
      continue;
    }
    try {
      if (!url.startsWith('https://') || !/^\d+$/.test(id)) throw new Error('URL o id no válidos');
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = IMG_TYPES[(res.headers.get('content-type') ?? '').split(';')[0].trim()];
      if (!ext) throw new Error('el contenido no es una imagen admitida');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_CREST_BYTES) throw new Error('imagen demasiado grande');
      const file = `img/escudos/${id}.${ext}`;
      await writeFile(join(ROOT, 'public', file), buf);
      manifest[id] = { url, file };
      result[id] = file;
      changed = true;
      await new Promise((r) => setTimeout(r, 300)); // sin ráfagas contra el CDN
    } catch (err) {
      console.warn(`! escudo del equipo ${id} no descargado (${err.cause?.code ?? err.message})`);
      if (known) result[id] = known.file; // conserva el anterior
    }
  }
  if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return result;
}

async function writeAtomic(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await rename(tmp, path);
}

// ---------- main ----------
const url = process.env.FVB_URL;
if (!url) fail('Falta FVB_URL. Define la variable en .env (ver .env.example).');

let data;
let apiUrl;
try {
  apiUrl = seasonUrl(url);
  const [raw, pistas] = await Promise.all([
    download(apiUrl),
    readFile(PISTAS, 'utf8').then(JSON.parse, () => ({})),
  ]);
  const crests = await syncCrests(raw);
  data = normalize(raw, pistas, crests);
} catch (err) {
  fail(err.message);
}

// Para el modo "en directo" de la web (el navegador consulta la API los días de partido).
// Es el mismo token público que usa basketbasko.com; el archivo no se sube a git.
await writeAtomic(LIVE_CONFIG, { url: apiUrl });

let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}
trackChanges(data, previous);

// Si nada cambia (salvo generatedAt) no se reescribe, para no ensuciar commits cada hora.
const strip = ({ generatedAt, ...rest }) => JSON.stringify(rest);
if (previous && strip(previous) === strip(data)) {
  console.log('✓ Sin cambios en los datos.');
} else {
  await writeAtomic(OUT, data);
  // Copia por temporada: al empezar la siguiente, la anterior queda como historial.
  if (data.grupo.temporada) await writeAtomic(join(SEASONS_DIR, `${data.grupo.temporada}.json`), data);
  const n = data.jornadas.filter((j) => j.estado === 'partido').length;
  const jugados = data.grupoPartidos.filter((m) => m.marcador).length;
  console.log(`✓ partidos.json actualizado (${n} partidos nuestros de ${data.totalJornadas} jornadas; ${jugados} resultados en el grupo).`);
}
