# Leioa SBT · Minibasket A

Web estática (HTML/CSS/JS vanilla) con los partidos del equipo, pensada para móvil.

## Uso

Requiere Node ≥ 22.9. No hay dependencias.

```
cp .env.example .env      # y pon tu URL real en FVB_URL (el .env no se sube a git)
npm run build             # descarga + normaliza (update) y genera el calendario (ics)
npm run serve             # http://localhost:8080
```

Scripts sueltos: `npm run update` (escribe `public/data/partidos.json`) y `npm run ics` (escribe `public/calendario.ics`).

## Cómo funciona

- `scripts/update.mjs`: una petición a `getAllGamesByGrupWithMatchRecords/<grupo>` (se deriva de `FVB_URL`, que apunta a `resultats/<grupo>` y solo trae dos jornadas), con User-Agent identificable y sin reintentos. Si falla, conserva el `partidos.json` anterior. Guarda nuestros partidos (idTeam 17087) con equipaciones, todos los partidos del grupo y la clasificación (la de la API o, si aún no la publica, calculada con los resultados).
- Cambios de fecha, hora o pista: se detectan comparando con el `partidos.json` anterior y se acumulan en `partido.cambios`. Por eso el workflow sube los datos a git en cada ejecución con cambios; eso también deja el historial (y una copia por temporada en `public/data/temporadas/`).
- En directo: los días con partidos del grupo, el navegador consulta la API cada 2 minutos (`public/js/live.js`). En minibasket no hay marcador en vivo: el resultado aparece cuando se cierra el acta. La URL la escribe `update.mjs` en `public/data/directo.json` (no se sube a git; se publica en la web, con el mismo token público que usa basketbasko.com).
- Web instalable: `manifest.webmanifest` + `sw.js` (abre sin conexión con los últimos datos vistos).
- `data/pistas.json`: datos manuales por pista (coordenadas si faltan, aparcamiento, notas, foto). Clave = `idField` o nombre de la pista.
- Horas 00:00 y 23:59 = "hora por confirmar": no se muestran como hora ni generan evento con hora en el `.ics` (se usa día completo).

## Privacidad

Sin analítica ni cookies. No se guardan nombres ni fotos de menores: del acta y de las fichas de equipo de la API no se usa nada (traen datos de los jugadores). Los escudos se descargan una vez a `public/img/escudos/` y se sirven en local.
