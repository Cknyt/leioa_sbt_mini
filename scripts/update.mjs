// Descarga el JSON de la federación, lo normaliza y escribe public/data/partidos.json.
// Una sola petición por ejecución. Si algo falla, el partidos.json anterior se conserva.
// La URL (FVB_URL) nunca se imprime: contiene un token.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'partidos.json');
const PISTAS = join(ROOT, 'data', 'pistas.json');

const TEAM_ID = '17087';
const TEAM_NAME = 'Leioa SBT';
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

// ---------- normalización ----------
const clean = (v) => (v === undefined || v === null || v === '' ? null : v);
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeMatch(m, pistas) {
  const [fecha, horaRaw = ''] = String(m.matchDay).split(' ');
  const hhmm = horaRaw.slice(0, 5);
  // 00:00 y 23:59 son marcadores de "hora por confirmar".
  const horaPendiente = !hhmm || hhmm === '00:00' || hhmm === '23:59';
  const local = String(m.idLocalTeam) === TEAM_ID;

  const pista = pistas[m.idField] ?? pistas[m.nameField] ?? {};
  const apiLat = num(m.latitudeField);
  const apiLng = num(m.longitudeField);
  const lat = apiLat ?? num(pista.lat);
  const lng = apiLng ?? num(pista.lng);

  const played = m.localScore !== null && m.visitorScore !== null;
  return {
    idMatch: String(m.idMatch),
    jornada: Number(m.numMatchDay),
    fecha,
    hora: horaPendiente ? null : hhmm,
    horaPendiente,
    franja: m.dayTime === 'T' ? 'T' : 'M', // M = mañana, T = tarde
    local,
    rival: {
      id: String(local ? m.idVisitorTeam : m.idLocalTeam),
      nombre: local ? m.nameVisitorTeam : m.nameLocalTeam,
      escudo: clean(local ? (m.logoVisitant ?? m.logoVisitante) : m.logoLocal),
    },
    equipoLocal: m.nameLocalTeam,
    equipoVisitante: m.nameVisitorTeam,
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
    marcador: played
      ? { local: Number(m.localScore), visitante: Number(m.visitorScore) }
      : null,
  };
}

// Clasificación: la API la devuelve vacía por ahora, así que el formato real se desconoce.
// Se aceptan varios nombres de campo habituales; lo que no se reconozca queda en null.
const STANDING_FIELDS = {
  id: ['idTeam', 'idEquip'],
  nombre: ['nameTeam', 'teamName', 'name'],
  posicion: ['position', 'pos', 'order', 'classification'],
  jugados: ['matchesPlayed', 'played', 'gamesPlayed', 'pj'],
  ganados: ['wins', 'won', 'matchesWon', 'pg'],
  perdidos: ['losses', 'lost', 'matchesLost', 'pp'],
  empatados: ['draws', 'tied', 'matchesTied', 'pe'],
  puntosFavor: ['pointsFor', 'scoredPoints', 'favor', 'pf'],
  puntosContra: ['pointsAgainst', 'concededPoints', 'against', 'pc'],
  puntos: ['points', 'puntos', 'pts'],
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
    // Aviso útil para ajustar el mapeo cuando la API empiece a rellenarlo (solo nombres de campo).
    console.warn(`! standing no reconocido; campos recibidos: ${Object.keys(rows[0] ?? {}).join(', ')}`);
  }
  const hasPos = out.every((r) => r.posicion !== null);
  return out.sort((a, b) =>
    hasPos
      ? a.posicion - b.posicion
      : (b.puntos ?? 0) - (a.puntos ?? 0) ||
        (b.puntosFavor ?? 0) - (b.puntosContra ?? 0) - ((a.puntosFavor ?? 0) - (a.puntosContra ?? 0)));
}

function normalize(raw, pistas) {
  if (raw?.result !== 'OK' || !raw.messageData?.rounds) {
    throw new Error('formato inesperado: falta result "OK" o messageData.rounds');
  }
  const md = raw.messageData;
  const lastRound = Number(md.lastRound) || null;
  const restIds = new Set();
  const restByRound = new Map();
  if (lastRound) {
    restByRound.set(lastRound, Object.keys(md.restCurrentRound ?? {}));
    restByRound.set(lastRound + 1, Object.keys(md.restNextRound ?? {}));
  }
  for (const [r, ids] of restByRound) if (ids.includes(TEAM_ID)) restIds.add(r);

  const jornadas = Object.entries(md.rounds)
    .map(([k, round]) => ({ n: Number(k), round }))
    .sort((a, b) => a.n - b.n)
    .map(({ n, round }) => {
      const matches = Object.values(round.matches ?? {});
      const base = { jornada: n, fecha: round.date ?? null };
      const ours = matches.find(
        (m) => String(m.idLocalTeam) === TEAM_ID || String(m.idVisitorTeam) === TEAM_ID,
      );
      if (ours) return { ...base, estado: 'partido', partido: normalizeMatch(ours, pistas) };
      // Jornada asignada en la que no aparecemos, o la API lo indica: descansamos.
      if (matches.length > 0 || restIds.has(n)) return { ...base, estado: 'descansa' };
      return { ...base, estado: 'pendiente' };
    });

  return {
    generatedAt: new Date().toISOString(),
    equipo: { id: TEAM_ID, nombre: TEAM_NAME },
    grupo: {
      nombre: md.group?.nameGroup ?? null,
      competicion: md.group?.competitionName ?? null,
      categoria: md.group?.categoryName ?? null,
      temporada: md.group?.season ?? null,
    },
    jornadaActual: lastRound,
    totalJornadas: Number(md.totalRounds) || jornadas.length,
    jornadas,
    clasificacion: normalizeStanding(md.standing),
  };
}

// ---------- main ----------
const url = process.env.FVB_URL;
if (!url) fail('Falta FVB_URL. Define la variable en .env (ver .env.example).');

let data;
try {
  const [raw, pistas] = await Promise.all([
    download(url),
    readFile(PISTAS, 'utf8').then(JSON.parse, () => ({})),
  ]);
  data = normalize(raw, pistas);
} catch (err) {
  fail(err.message);
}

// Si nada cambia (salvo generatedAt) no se reescribe, para no ensuciar commits cada hora.
let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}
const strip = ({ generatedAt, ...rest }) => JSON.stringify(rest);
if (previous && strip(previous) === strip(data)) {
  console.log('✓ Sin cambios en los datos.');
} else {
  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, OUT);
  const n = data.jornadas.filter((j) => j.estado === 'partido').length;
  console.log(`✓ partidos.json actualizado (${n} partidos asignados de ${data.totalJornadas} jornadas).`);
}
