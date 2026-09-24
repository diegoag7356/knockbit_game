# KNOCKBIT — Documento de Diseño

## 1. Resumen del juego
Knockbit es una arena 2D multijugador de partidas cortas, jugable desde el navegador. Cada jugador controla una "cajita" de color personalizable con ojos que siguen al cursor del ratón. El combate se basa en un ataque común (bate) y en el uso estratégico de habilidades, tanto pasivas como activables, en mapas de distintas formas que condicionan la táctica.

Pensado para partidas rápidas entre amigos (por ejemplo, en clase), con salas de 2 a 8 jugadores.

## 2. Requisitos técnicos
- Debe funcionar bien en equipos con 8 GB de RAM.
- Multijugador en tiempo real (salas).
- Estética indie, ligera, sin necesidad de arte complejo: colisiones baratas (cajitas/círculos simples).

## 3. Estilo visual
- Personajes: cajitas 2D de color personalizable.
- Ojos que siguen la posición del cursor del ratón (detalle de vida sin animación compleja).
- Mapas geométricos y minimalistas: círculo, cuadrado, y (futuro) formas irregulares (L, estrella, etc.).
- Tono general: simple, gracioso, sin pretensiones de gran producción.

## 4. Controles
- Movimiento: WASD.
- Ataque: golpe de bate (acción base, común a todos los jugadores).
- Habilidad activable: tecla dedicada (a definir por el agente, ej. Shift/Espacio/Click derecho).

## 5. Mecánica de combate
- Todos los jugadores atacan con el mismo tipo de golpe: un bate.
- Golpear a otro jugador:
  - En modo **Vidas**: reduce una porción de vida del golpeado.
  - Siempre: aplica un empuje (knockback) leve al golpeado.

## 6. Habilidades fijas (pasivas)
Se elige **1 de 3** antes de empezar la partida. Son pasivas y duran toda la partida:

1. **Alcance** — aumenta el alcance del bate.
2. **Impacto** — aumenta el empuje del golpe (debe notarse claramente, pero sin ser desproporcionado).
3. **Ritmo** — reduce ligeramente el cooldown de la habilidad activable (poco, pero perceptible).

## 7. Habilidades activables
Se elige **1** para usar durante la partida (o se definen por sala/personaje, a decidir en implementación). Ninguna debe aumentar vida ni daño directamente.

1. **Dash**
   - Cooldown: 5 segundos.
   - Efecto: impulso corto en la dirección actual de movimiento.

2. **Backstab (Teletransporte)**
   - Cooldown: 30 segundos.
   - Efecto: te teletransportas detrás del enemigo más cercano y le golpeas automáticamente en la dirección desde la que venías.
   - Restricción: no se puede activar si el teletransporte te sacaría fuera de los límites de la cancha.
   - Ejemplo visual del efecto:
     ```
     Antes:   A ---- B
     (A activa Backstab, aparece detrás de B en la dirección desde la que venía)
     Después: B ---- A
     (A golpea automáticamente a B empujándolo)
     Resultado: B ------------ A
     ```

3. **Caparazón (Escudo)**
   - Cooldown: 15 segundos.
   - Efecto: mientras está activo, el jugador es inmune a daño y a empuje.
   - Contrapartida: mientras está activo, los golpes propios no quitan vida y empujan menos de lo normal.

## 8. Modos de juego

### 8.1 Territorio (expulsión)
- Objetivo: ser el último jugador dentro del área jugable.
- A partir del segundo 30 de partida, la zona jugable empieza a encogerse progresivamente.
- La eliminación es por expulsión fuera de la zona válida, no por daño/vida.

### 8.2 Vidas
- Cada jugador empieza con 3 vidas.
- Se pierde una vida al recibir suficiente daño / ser expulsado del área, según se defina en implementación.
- Un jugador queda eliminado al perder sus 3 vidas.
- Último jugador en pie gana.

## 9. Mapas
- **Círculo**: favorece estrategias de rodeo, no hay esquinas donde acorralar.
- **Cuadrado**: las esquinas son zonas de riesgo (fácil quedar acorralado).
- **Futuro**: formas irregulares (L, estrella, etc.) para variar ángulos y pasillos.

## 10. Sistema de salas
- Los jugadores crean o se unen a una sala (por ejemplo, mediante código).
- Mínimo 2 jugadores, máximo 8 por sala.
- El anfitrión decide cuándo empezar la partida (o se lanza automáticamente al llegar al máximo, a definir en implementación).

## 11. Justificación técnica del diseño
- Sistemas independientes: mapa, combate y habilidades no dependen entre sí, lo que permite añadir contenido nuevo sin romper lo existente.
- Colisiones simples (formas básicas), reduciendo coste de cálculo y dejando margen para lógica de juego más rica.
- Poco arte necesario: el esfuerzo de desarrollo se centra en la mecánica y el netcode, no en assets.

## 12. Alcance del MVP
El MVP debe incluir, como mínimo:
- Movimiento WASD + ataque de bate funcional con empuje.
- Un mapa (círculo o cuadrado, a elección del agente para empezar).
- Las 3 habilidades activables (Dash, Backstab, Caparazón) y las 3 habilidades fijas.
- Modo Territorio completo (con encogimiento de zona a partir del segundo 30).
- Sistema de salas básico (crear sala, unirse, mínimo 2 / máximo 8 jugadores, empezar partida).
- Personalización de color del personaje y ojos que siguen al ratón.

El modo Vidas y los mapas adicionales pueden considerarse extensiones post-MVP si el tiempo no permite incluirlos desde el inicio.
