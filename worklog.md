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

## 2026-09-24 — Combate visual, expulsión y optimización
- Qué se hizo: se corrigió la eliminación al salir del borde exterior para que un golpe pueda expulsar realmente a un jugador; el bate queda visible apuntando al ratón y conserva su arco de golpeo; se reforzaron los efectos de Dash y Backstab; se suavizó la interpolación de jugadores remotos, se sincronizó la animación del bate y se redujo el coste visual del canvas para equipos modestos.
- Archivos afectados: src/game.js, src/main.js.
- Decisiones tomadas: se mantiene un margen breve de 280 ms fuera del círculo para absorber latencia, pero no se recoloca al jugador ni se bloquea el knockback; los saltos remotos grandes se aplican de inmediato y el movimiento normal se interpola.
- Pendiente / siguiente paso: completado con build, publicación y verificación pública.

## 2026-09-24 — Publicación de correcciones de combate
- Qué se hizo: el build de producción pasó; se creó el commit `0510f11`, se subió a `main` y se publicó la nueva build en `gh-pages`. La URL pública respondió HTTP 200.
- Archivos afectados: src/game.js, src/main.js, worklog.md, rama remota `gh-pages`.
- Decisiones tomadas: se mantiene Vite como build estática y el límite de DPR en 1.25 para priorizar fluidez en Macs con 8 GB de RAM sin eliminar sombras, partículas ni feedback de habilidades.
- Pendiente / siguiente paso: ninguno.

## 2026-09-24 — Ajustes de gráficos, sonido y Firebase protegido
- Qué se hizo: se añadió un menú de Ajustes en el menú principal con perfiles de gráficos (Optimizado, Normal, Alto: resolución, límite de FPS y densidad de partículas) y un interruptor de sonido; se implementaron sonidos procedurales (WebAudio) para el swing del bate, el Dash, el teleport de Backstab, el Caparazón y el impacto, tanto propios como recibidos en red; se activó Anonymous Auth como requisito para usar la base de datos, se dejó el dominio autorizado solo en `diegoag7356.github.io` (más `localhost` y los dominios del propio proyecto) y se endurecieron las reglas de RTDB: solo usuarios autenticados, cada jugador solo escribe su propio nodo, golpes solo autenticados y estado de partida por cualquiera autenticado.
- Archivos afectados: src/game.js, src/main.js, src/style.css, src/firebase.js, database.rules.json, worklog.md.
- Decisiones tomadas: el sonido se genera con WebAudio (sin ficheros de audio) para no aumentar el peso de la build; el perfil «Optimizado» conserva el ajuste previo (DPR 1.25, 55 FPS, 72 partículas); las preferencias se guardan en `localStorage`; no se puede bloquear por reglas el acceso por dominio (las reglas de RTDB no ven el origen), así que la protección anti-copia es Auth anónima + dominios autorizados de Identity Toolkit, que sí la impiden de facto; se permite que cualquier jugador autenticado escriba `state` para que la vuelta a lobby tras la partida siga funcionando igual.
- Pendiente / siguiente paso: build, verificación local y publicación.

## 2026-09-24 — Publicación de ajustes, sonido y seguridad
- Qué se hizo: build de producción correcta; se publicó la nueva build en `gh-pages`; se creó el commit `b5c9cf4` y se subió a `main`; la URL pública responde HTTP 200. Se verificaron por consola las reglas en vivo: lectura/escritura solo autenticada, nodo de jugador ajeno bloqueado, sala ajena bloqueada, golpes y estado OK.
- Archivos afectados: rama remota `gh-pages`, repositorio remoto `main`, worklog.md.
- Decisiones tomadas: los ajustes viven solo en el dispositivo del jugador (sin sincronizar), suficiente para el alcance actual.
- Pendiente / siguiente paso: ninguno.

## 2026-09-24 — Corrección: crear sala fallaba con permission_denied
- Qué se hizo: el error ocurría porque las salas se escribían con el ID antiguo de `localStorage` como clave de jugador, y las reglas nuevas exigen que la clave coincida con `auth.uid`. Ahora la app adopta el UID de la Auth anónima como identidad en cuanto la sesión está lista, y los flujos de crear/unirse esperan a esa sesión antes de tocar la base de datos. Se simuló el flujo real de creación contra Firebase (create + onDisconnect + update + read) y pasó completo.
- Archivos afectados: src/main.js.
- Decisiones tomadas: si la Auth anónima falla (p. ej. dominio no autorizado), se muestra un aviso claro y no se permite crear/unirse a salas.
- Pendiente / siguiente paso: publicación de la corrección (commit `cc39336` en `main` y build nueva en `gh-pages`).

## 2026-09-24 — Modo Vidas, jugabilidad y robustez online
- Qué se hizo: lote completo de mejoras acordadas en plan: (1) colisiones físicas entre jugadores (el Caparazón no es empujado), (2) aro de alcance propio que crece con la pasiva Alcance, (3) avisos de zona (sonido de tensión al encogerse, anillo pulsante, viñeta roja si estás fuera, tics periódicos), (4) muerte súbita: tras terminar el encogimiento la zona sigue encogiendo lentamente hasta radio mínimo 24 y el borde se tiñe de rojo, (5) Modo Vidas completo con selector en el lobby (3 impactos = 1 vida; salir del área = 1 vida y reaparición cerca del centro; corazones en el HUD y sobre cada jugador), (6) espectador en vivo: al morir sigues viendo la partida en tiempo real con banner "ELIMINADO", (7) migración de anfitrión automática si el host se desconecta, (8) limpieza de salas vacías (el último en salir borra la sala), (9) ranking de eliminación en la pantalla de resultados, (10) ping visible en el HUD con umbral de colores, (11) movimiento alternativo con flechas y sonidos de victoria/derrota.
- Archivos afectados: src/game.js, src/main.js, src/style.css, database.rules.json, worklog.md.
- Decisiones tomadas: las vidas viajan en el nodo de cada jugador (`lives`, `hitsTaken`) para no tocar la arquitectura de reglas; el ranking usa `state/eliminationOrder/{n}` escrito por el cliente que detecta la eliminación (los duplicados son inofensivos y se reordenan por clave); el ping usa `.info/serverTimeOffset` + eco propio cada 5 s; se endureció además la regla de `players` para exigir `id === auth.uid` dentro del propio nodo (cerrado un vector multi-write detectado en las pruebas).
- Pendiente / siguiente paso: build final, verificación y publicación.

