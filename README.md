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

- `scripts/update.mjs`: la URL base solo trae dos jornadas, así que pide además `FVB_URL/N` para las jornadas vacías (cada respuesta trae N y N+1; ~9 peticiones espaciadas), con User-Agent identificable y sin reintentos. Si falla, conserva el `partidos.json` anterior. Filtra por idTeam 17087.
- `data/pistas.json`: datos manuales por pista (coordenadas si faltan, aparcamiento, notas, foto). Clave = `idField` o nombre de la pista.
- Horas 00:00 y 23:59 = "hora por confirmar": no se muestran como hora ni generan evento con hora en el `.ics` (se usa día completo).
- La web solo lee `data/partidos.json`; el navegador nunca llama a la federación.

## Privacidad

Sin analítica ni cookies. No se guardan nombres ni fotos de menores. Los escudos se descargan una vez a `public/img/escudos/` y se sirven en local.
