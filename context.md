# CONTEXT.md — Rediseño UI/UX + ceremonia de colores + ajustes de combate (Knockbit)

> Documento de especificación del lote actual. Todo lo que pidió el usuario está aquí.
> Al final: **checklist de pruebas** para el usuario.

---

## 0. Objetivo general

La gente dice que el juego "parece hecho por IA". Objetivo: que **no lo parezca**. Estética artesanal,
con carácter, imperfecta a propósito: grano de textura, tipografía con personalidad, sombras duras,
micro-detalles (la K que parpadea como un ojo, el cuby que gira para mirar al ratón, botones que se
hunden al pulsar). Nada de gradientes púrpura genéricos ni cards centradas idénticas.

## 1. Menú principal (en capas)

1. **Capa 1**: logo del juego + botón Ajustes + campo de nombre. Debajo, un único botón grande: **JUGAR**.
2. JUGAR desvanece todo y aparece: **Crear sala** / **Unirse a sala** (+ volver).
3. **Crear sala**: la pantalla se oscurece unos segundos (transición de cortina) y aparece el panel de control de la sala.
4. **Unirse a sala**: 5 cuadrados grandes que se rellenan en MAYÚSCULAS según escribes; pegar un código funciona.

## 2. Sala (panel de control)

- Solo se ve: **lista de jugadores** y **código para copiar**.
- El código también va en la **URL** (`?sala=XXXXX`): abrir esa URL lleva a una pantalla
  "Te están invitando a una sala" → escribes tu nombre → botón **Unirse** → apareces en la sala.
- **Listo**: todos deben darle a LISTO para arrancar; si alguien no ha dado, el anfitrión no puede arrancar.
- El anfitrión puede **expulsar** jugadores.
- Orden de la lista: **anfitrión primero**, luego jugadores **en orden de unión**.

## 3. Ceremonia de elección de color (sincronizada)

1. Cuando todos dan a LISTO → **pantalla negra para todos a la vez**: gate de recursos en Firebase
   (`state/loadouts/{uid}.ready`). Nadie arranca hasta que TODOS tengan los recursos cargados;
   si falta uno, se espera. Cuando todos cargan → +1 s extra y encender; mínimo **3 s** de negro
   aunque cargue instantáneo (en `t0` acordado por el host).
2. Pantalla de carga con barra y textos rotativos ("Cargando recursos…", "Ya casi estamos…", "Inicializando…").
3. Al encender: **cuadro central con los 8 colores**; encima, el **cuby** (cuadrado gris con ojos que
   siguen al ratón, con el nombre del jugador) que cambia de color según la selección.
4. **15 s** por jugador: contador arriba a la izquierda; **Confirmar** arriba a la derecha (pasa al siguiente).
   Si se agota el tiempo, se asigna el color que tuviera seleccionado.
5. Al confirmar: animación del cuby **saliendo por la izquierda** y el siguiente cuby **entrando desde la derecha**.
6. Durante todo el proceso, **líneas de velocidad** (caída libre) de fondo. Todos lo ven en vivo;
   solo el jugador del turno puede elegir.
7. Al terminar el último: todos los cubys en **fila horizontal abajo**, mirando arriba hacia un
   **trofeo** central, texto "¡COMENZANDO!". Después, gate de recursos de partida → redirige a todos juntos.

## 4. Partida

- **Overlay semitransparente** (se ve un poco la arena): 15 s para elegir pasiva + habilidad y dar a
  LISTO; si acaba el tiempo, se elige lo que tengas puesto. Al estar listo (o al agotarse), aparece tu
  **animación de spawn** en la arena (visible para todos).
- Cuando todos han hecho spawn → **1 s** de pausa → **cuenta atrás 3-2-1** → ¡a jugar!
- **Arena escalable**: a más jugadores, algo más grande (solo lo necesario).
- **Flecha** encima de tu cuby que te sigue siempre (identificarte).
- **Bate**: no se puede spamear (cooldown ~0,7 s); el swing es más lento y "de verdad".
  Área de golpeo de **120° centrada donde miras** (60° por lado) — el arco visual del bate coincide.
  El cooldown del bate es INDEPENDIENTE del backstab y la pasiva Ritmo NO reduce el cooldown del bate
  (solo el de habilidades accionables).
- **Backstab**: solo funciona a corta distancia (~el alcance del bate con la pasiva Alcance);
  indicador de disponibilidad cuando estás en rango y sin cooldown.
- **Indicadores de habilidad** con el reojo: cono/radial de cooldown, pulso y "¡LISTA!" cuando cargan.
- **ESC**: menú de pausa para salir de la sala o cambiar gráficos; el juego NO se pausa (te pueden
  golpear y sales de la arena igual).
- **Borde de arena preciso** con **viñeta roja gradual** por las esquinas al acercarte al límite
  (o cuando el límite se acerca a ti).
- **Pestaña oculta**: no te pueden golpear mientras estás en otra pestaña, pero si sales de la arena
  estando fuera, pierdes igual (el tick sigue corriendo).

## 5. Técnico

- Firebase: nuevos nodos `state/loadouts/{uid}` (gate de recursos), `state/turn` (turno de color),
  `state/spawns/{uid}` (spawn hecho), `state/countdownAt` (arranque sincronizado), `state/kickNonce`.
- Reglas desplegadas antes de probar.
- Build de producción verificada.

---

## ✅ CHECKLIST DE PRUEBAS (bórralas conforme pruebes)

### Menú y flujo base
- [ ] Al abrir: solo se ve logo + Ajustes + nombre + botón JUGAR.
- [ ] JUGAR desvanece y aparece Crear sala / Unirse a sala (con botón volver).
- [ ] Crear sala: pantalla se oscurece unos segundos → aparece panel de sala.
- [ ] Unirse: 5 cuadrados, se escriben en mayúsculas, pegar un código completo rellena los 5.
- [ ] URL con `?sala=XXXXX` abre directamente "Te están invitando a una sala" → nombre → Unirte.
- [ ] La URL se copia con el botón de copiar (código + enlace).

### Sala
- [ ] La lista muestra primero ANFITRIÓN y luego jugadores en orden de unión.
- [ ] Botón LISTO por jugador; el anfitrión ve "X/Y listos" y no puede arrancar sin todos.
- [ ] Cuando todos listan, arranca solo (transición a ceremonia de colores).
- [ ] El anfitrión puede expulsar a un jugador y desaparece de la lista.
- [ ] El expulsado ve un aviso y vuelve al menú.

### Ceremonia de colores
- [ ] Al listar todos: pantalla NEGRA en todos a la vez, con barra y textos de carga.
- [ ] Aunque uno tenga la pestaña lenta, todos esperan (gate de recursos) — prueba con DevTools "Slow CPU".
- [ ] Mínimo 3 s de negro aunque cargue al instante, y +1 s tras completar todos.
- [ ] Se encienden TODOS a la vez (pruébalo en 2 navegadores).
- [ ] Cuby gris con tu nombre encima de la paleta; los ojos siguen al ratón.
- [ ] Al cambiar de color, el cuby cambia al instante.
- [ ] Contador de 15 s arriba-izquierda; botón CONFIRMAR arriba-derecha.
- [ ] Confirmar: tu cuby sale por la izquierda y el siguiente entra por la derecha (visible en las 2 pantallas).
- [ ] Si se acaba el tiempo, se asigna el color seleccionado y pasa al siguiente.
- [ ] Líneas de velocidad de fondo durante toda la ceremonia.
- [ ] Al final del último: fila de cubys abajo mirando al trofeo + "¡COMENZANDO!" + redirección conjunta.

### Partida
- [ ] Overlay semitransparente con pasiva/habilidad y LISTO; cuenta atrás de 15 s visible.
- [ ] Si no das a LISTO, a los 15 s se elige lo que tuvieras y aparece tu spawn.
- [ ] Animación de spawn visible en los demás clientes.
- [ ] Cuando todos tienen spawn: 1 s de espera → cuenta atrás 3-2-1 → control.
- [ ] La arena es algo más grande con más jugadores.
- [ ] Flecha encima de tu cuby siguiéndote siempre.
- [ ] El bate no se puede spamear (cooldown visible); el swing va a velocidad "humana".
- [ ] Golpeas aunque no sea con la punta: área de 120° centrada donde miras.
- [ ] La pasiva Ritmo NO reduce el cooldown del bate; el backstab no lo resetea.
- [ ] Backstab solo funciona muy cerca (~alcance de bate con Alcance); hay indicador de rango.
- [ ] Indicador de habilidad junto al cuby: se vacía al usar, pulsa y avisa al cargar.
- [ ] ESC abre menú: cambiar gráficos y salir de la sala; el juego sigue (te golpean en el menú).
- [ ] Viñeta roja gradual al acercarte al borde (o al acercarse la zona a ti).
- [ ] Salir de la arena te elimina de forma fiable (antes a veces no pasaba nada).
- [ ] Con la pestaña en segundo plano no te golpean, pero si estás fuera de la zona, pierdes igual.
