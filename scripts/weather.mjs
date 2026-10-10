// Previsión Open-Meteo (sin API key) para partidos a menos de 7 días y con coordenadas.
// Escribe public/data/tiempo.json. Una petición por partido; si falla, conserva el archivo anterior.
// Uso: node scripts/weather.mjs [--days=7] [--dry]   (--days hasta 16, útil para probar)
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public', 'data', 'partidos.json');
const OUT = join(ROOT, 'public', 'data', 'tiempo.json');
const USER_AGENT = 'leioa-sbt-mini-web/0.1 (web de familias; contacto: info@experienciatek.com)';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`));
const DAYS = Math.min(16, Number(arg('days')?.split('=')[1]) || 7);
const DRY = Boolean(arg('dry'));

// Códigos WMO → texto e icono.
function wmo(code) {
  if (code === 0) return ['Despejado', '☀️'];
  if (code <= 2) return ['Poco nuboso', '🌤️'];
  if (code === 3) return ['Nublado', '☁️'];
  if (code <= 48) return ['Niebla', '🌫️'];
  if (code <= 57) return ['Llovizna', '🌦️'];
  if (code <= 67) return ['Lluvia', '🌧️'];
  if (code <= 77) return ['Nieve', '🌨️'];
  if (code <= 82) return ['Chubascos', '🌦️'];
  if (code <= 86) return ['Chubascos de nieve', '🌨️'];
  return ['Tormenta', '⛈️'];
}

const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

async function forecast(m) {
  const { lat, lng } = m.pista;
  // Sin hora confirmada se usa una hora representativa de la franja.
  const hora = m.hora ?? (m.franja === 'T' ? '17:00' : '11:00');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    timezone: 'Europe/Madrid',
    wind_speed_unit: 'kmh',
    start_date: m.fecha,
    end_date: m.fecha,
  });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const h = (await res.json()).hourly;
  const i = h.time.indexOf(`${m.fecha}T${hora.slice(0, 2)}:00`);
  if (i < 0) throw new Error(`sin datos horarios para ${m.fecha}`);
  const [descripcion, icono] = wmo(h.weather_code[i]);
  return {
    fecha: m.fecha,
    horaReferencia: hora,
    aproximada: !m.hora,
    temperatura: Math.round(h.temperature_2m[i]),
    probLluvia: h.precipitation_probability[i],
    viento: Math.round(h.wind_speed_10m[i]),
    descripcion,
    icono,
  };
}

const data = JSON.parse(await readFile(DATA, 'utf8'));
const today = madridToday();
const targets = data.jornadas
  .filter((j) => j.estado === 'partido')
  .map((j) => j.partido)
  .filter((m) => !m.marcador && m.pista.lat != null && m.pista.lng != null)
  .filter((m) => {
    const d = dayDiff(today, m.fecha);
    return d >= 0 && d < DAYS;
  });

const result = {};
try {
  for (const m of targets) result[m.idMatch] = await forecast(m);
} catch (err) {
  console.error(`✗ ${err.message}. Se conserva el tiempo.json anterior.`);
  process.exit(1);
}

if (DRY) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const out = { generatedAt: new Date().toISOString(), partidos: result };
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, JSON.stringify(out, null, 2) + '\n');
  await rename(tmp, OUT);
  console.log(`✓ tiempo.json: ${targets.length} previsiones (ventana de ${DAYS} días).`);
}
