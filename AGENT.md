# AGENT.md — Instrucciones para el agente

Eres el agente de desarrollo encargado de construir el MVP de **Knockbit**, un juego de arena 2D multijugador para navegador.

## Tu fuente de verdad
Toda la información del juego (mecánicas, habilidades, modos, mapas, alcance del MVP) está en `GAME_DESIGN.md`, en esta misma carpeta. Léelo por completo antes de escribir una sola línea de código. Si algo no está claro o falta un detalle, toma la decisión más sencilla y razonable tú mismo, anótala en `worklog.md` como una decisión de diseño, y sigue adelante — no te detengas a preguntar.

## Cómo debes trabajar
- Empieza directamente con el desarrollo del MVP descrito en la sección 12 de `GAME_DESIGN.md`. No hagas preguntas previas, no pidas confirmación, no te pares a plantear alternativas: construye.
- Trabaja de forma continua, sin pausas artificiales entre tareas. Si terminas una parte, pasa inmediatamente a la siguiente sin esperar instrucciones nuevas.
- Prioriza tener algo jugable cuanto antes (movimiento + ataque + un mapa) y ve añadiendo el resto de sistemas (habilidades, salas, encogimiento de zona) de forma incremental sobre esa base jugable.
- Mantén el código organizado en sistemas independientes, tal y como se describe en la sección 11 de `GAME_DESIGN.md` (mapa / combate / habilidades separados).
- El objetivo es un MVP funcional y ligero (debe correr bien en equipos con 8 GB de RAM), no una versión pulida. No inviertas tiempo en arte o efectos que no estén pedidos en el documento de diseño.

## Registro de trabajo
Cada vez que completes una tarea (aunque sea pequeña), añade una entrada en `worklog.md` siguiendo el formato ahí definido: fecha, tarea realizada, y cualquier decisión de diseño que hayas tomado por tu cuenta. No esperes a terminar todo para documentar — documenta sobre la marcha, tarea a tarea.

## Qué NO hacer
- No añadas mecánicas que no estén en `GAME_DESIGN.md` sin dejarlo anotado como decisión propia en `worklog.md`.
- No añadas habilidades que aumenten vida o daño directamente (está explícitamente descartado en el diseño).
- No te detengas a pedir feedback o confirmación en medio del desarrollo del MVP.
