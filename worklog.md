# WORKLOG.md — Registro de trabajo (Knockbit)

Este archivo lo mantiene el agente de desarrollo. Cada entrada debe añadirse justo después de completar una tarea, no al final del día ni al final del proyecto.

## Formato de cada entrada

```
## [FECHA] — [TÍTULO CORTO DE LA TAREA]
- Qué se hizo: (descripción breve y concreta)
- Archivos afectados: (lista de archivos creados o modificados)
- Decisiones tomadas: (cualquier decisión de diseño o técnica no especificada en GAME_DESIGN.md, y por qué)
- Pendiente / siguiente paso: (qué queda para continuar)
```

## Ejemplo

```
## 2026-09-24 — Setup inicial del proyecto
- Qué se hizo: estructura base del proyecto, servidor de desarrollo funcionando.
- Archivos afectados: package.json, index.html, src/main.js
- Decisiones tomadas: se usa [tecnología elegida] porque [razón breve].
- Pendiente / siguiente paso: implementar movimiento WASD del jugador.
```

---

## 2026-09-24 — Scaffold y configuración de Firebase
- Qué se hizo: se creó la aplicación Vite vanilla con Firebase Realtime Database y se conectó la configuración web pública del proyecto con RTDB activo.
- Archivos afectados: package.json, package-lock.json, index.html, src/firebase.js, firebase.json, database.rules.json.
- Decisiones tomadas: se usa el proyecto Firebase existente `cars-realtime-database` porque la creación de una instancia nueva en `knockbit-game` devolvía 404 desde el Management API. Las reglas del MVP permiten lectura/escritura en salas sin autenticación para simplificar partidas entre amigos.
- Pendiente / siguiente paso: integrar núcleo jugable, lobby y sincronización de salas.

## 2026-09-24 — Núcleo jugable del MVP
- Qué se hizo: se implementaron el canvas, movimiento WASD, mapa circular, zona que se encoge desde el segundo 30, bate con empuje, ojos que siguen al cursor y HUD de partida.
- Archivos afectados: src/game.js, src/style.css.
- Decisiones tomadas: el mapa inicial se muestra completo en pantalla y el jugador queda fuera de la zona durante 1 segundo antes de ser eliminado, para tolerar latencia de red.
- Pendiente / siguiente paso: conectar habilidades, salas y lobby al estado de Firebase.

## 2026-09-24 — Salas, lobby y habilidades
- Qué se hizo: se implementaron creación/unión por código, límite de 2–8 al iniciar, presencia con `onDisconnect`, selección de color, pasiva y habilidad, inicio por anfitrión y pantalla de resultados. Se añadieron Dash, Backstab, Caparazón y las pasivas Alcance, Impacto y Ritmo.
- Archivos afectados: src/main.js, src/game.js, src/style.css.
- Decisiones tomadas: la tecla Espacio activa la habilidad; el click izquierdo ejecuta el bate; el anfitrión inicia manualmente la partida; Backstab busca al enemigo vivo más cercano y rechaza destinos fuera de la zona.
- Pendiente / siguiente paso: ejecutar build, corregir errores, probar Firebase y publicar.

## 2026-09-24 — Build de producción
- Qué se hizo: se añadió configuración de Vite para subruta relativa de GitHub Pages y alias local de Firebase; el build de producción terminó correctamente.
- Archivos afectados: vite.config.js, .firebaserc, dist/ generado.
- Decisiones tomadas: se usa `base: './'` para que los assets funcionen en `/<repositorio>/` sin depender de un dominio raíz.
- Pendiente / siguiente paso: desplegar reglas Firebase y verificar la aplicación en local.

## 2026-09-24 — Firebase y sincronización realtime verificados
- Qué se hizo: se desplegaron las reglas de Realtime Database y se verificó la URL de datos con respuesta HTTP 200. Se conectó la escucha de jugadores y eventos de golpe; los impactos se aplican al jugador víctima.
- Archivos afectados: src/main.js, src/game.js, database.rules.json.
- Decisiones tomadas: el cliente víctima aplica el knockback recibido por evento RTDB; es una arquitectura ligera adecuada para el MVP sin servidor dedicado. Se mantuvo un único mapa círculo para respetar el alcance mínimo.
- Pendiente / siguiente paso: publicar código y build en GitHub y GitHub Pages.

## 2026-09-24 — Publicación del código
- Qué se hizo: se inicializó Git, se creó el commit `5257fee` y se subió la rama `main` a `https://github.com/diegoag7356/knockbit_game`.
- Archivos afectados: repositorio completo del MVP.
- Decisiones tomadas: se usó la identidad local de GitHub `diegoag7356@users.noreply.github.com` únicamente para este commit.
- Pendiente / siguiente paso: publicar la build estática en GitHub Pages.

## 2026-09-24 — Despliegue en GitHub Pages
- Qué se hizo: se publicó `dist/` en la rama `gh-pages`; GitHub confirmó que Pages ya estaba habilitado para el repositorio.
- Archivos afectados: rama remota `gh-pages`.
- Decisiones tomadas: se usa despliegue por rama `gh-pages` en lugar de un workflow, porque la build Vite ya es estática y no requiere servidor.
- Pendiente / siguiente paso: ninguno; MVP publicado y verificado.

## 2026-09-24 — Verificación final
- Qué se hizo: se verificó `https://diegoag7356.github.io/knockbit_game/` con respuesta HTTP 200 y título correcto; también se verificó que el build final compila sin errores.
- Archivos afectados: worklog.md.
- Decisiones tomadas: se considera completado el MVP con el alcance de Territorio y mapa círculo; Vidas y mapas adicionales quedan fuera del MVP según la sección 12.
- Pendiente / siguiente paso: ninguno.

