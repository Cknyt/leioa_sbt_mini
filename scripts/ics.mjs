// Genera public/calendario.ics (RFC 5545) a partir de public/data/partidos.json.
// UID estable por idMatch: si cambia el horario, las suscripciones actualizan el evento.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public', 'data', 'partidos.json');
const OUT = join(ROOT, 'public', 'calendario.ics');

const TZ = 'Europe/Madrid';
const MATCH_MIN = 90; // duración del partido
const CONVOCATORIA_MIN = 45;
const SITE_URL = 'https://cknyt.github.io/leioa_sbt_mini/';

const data = JSON.parse(await readFile(DATA, 'utf8'));
const stamp = new Date(data.generatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

const esc = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Plegado de líneas a 75 octetos (UTF-8), sin partir caracteres.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // la continuación empieza con un espacio
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compact = (fecha) => fecha.replaceAll('-', '');
const nextDay = (fecha) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
};

const mapsUrl = (p) => {
  const dest =
    p.lat != null && p.lng != null
      ? `${p.lat},${p.lng}`
      : [p.nombre, p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
};

function event(m) {
  const p = m.pista;
  const local = m.local ? 'Local' : 'Visitante';
  const lines = ['BEGIN:VEVENT', `UID:partido-${m.idMatch}@leioa-sbt-mini`, `DTSTAMP:${stamp}`];
  if (m.hora) {
    // El evento empieza en la convocatoria y cubre hasta el final del partido.
    const start = m.convocatoria ?? m.hora;
    lines.push(`DTSTART;TZID=${TZ}:${compact(m.fecha)}T${start.replace(':', '')}00`);
    lines.push(`DURATION:PT${CONVOCATORIA_MIN + MATCH_MIN}M`);
  } else {
    // Hora por confirmar: evento de día completo (DTEND exclusivo).
    lines.push(`DTSTART;VALUE=DATE:${compact(m.fecha)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(m.fecha)}`);
  }
  lines.push(`SUMMARY:${esc(`${m.equipoLocal} - ${m.equipoVisitante}`)}`);
  const loc = [p.nombre, p.direccion, [p.codigoPostal, p.localidad].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  if (loc) lines.push(`LOCATION:${esc(loc)}`);
  if (p.lat != null && p.lng != null) lines.push(`GEO:${p.lat};${p.lng}`);
  const desc = [
    `Jornada ${m.jornada} · ${local}`,
    m.hora ? `Convocatoria: ${m.convocatoria} · Partido: ${m.hora}` : null,
    m.hora ? null : `Hora por confirmar (${m.franja === 'T' ? 'tarde' : 'mañana'})`,
    p.aparcamiento ? `Aparcamiento: ${p.aparcamiento}` : null,
    p.notas ? `Notas: ${p.notas}` : null,
    `Cómo llegar: ${mapsUrl(p)}`,
    `Más info: ${SITE_URL}`,
  ].filter(Boolean);
  lines.push(`URL:${SITE_URL}`);
  lines.push(`DESCRIPTION:${esc(desc.join('\n'))}`);
  lines.push('END:VEVENT');
  return lines;
}

// Zona horaria Europe/Madrid (reglas UE vigentes desde 1996).
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const matches = data.jornadas.filter((j) => j.estado === 'partido').map((j) => j.partido);
const lines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//leioa-sbt-mini-web//ES',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  `X-WR-CALNAME:${esc(`${data.equipo.nombre} minibasket`)}`,
  `X-WR-TIMEZONE:${TZ}`,
  'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  'X-PUBLISHED-TTL:PT1H',
  ...VTIMEZONE,
  ...matches.flatMap(event),
  'END:VCALENDAR',
];

await writeFile(OUT, lines.map(fold).join('\r\n') + '\r\n');
console.log(`✓ calendario.ics generado (${matches.length} eventos).`);
