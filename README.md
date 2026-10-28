# Misión Tablas

Práctica de las tablas de multiplicar y de dividir del 2 al 9 para niños de 9 años. La app descubre en qué multiplicaciones falla cada niño, se las repite hasta que las domina y las intercala con las que ya sabe. Las preguntas nunca se acaban.

**Para jugar:** https://hernandoarteaga.github.io/mision-tablas/

![Pantallas de Misión Tablas en un celular](docs/capturas.png)

## Cómo se juega

- En el inicio se elige **Multiplicar** o **Dividir**. Cada modo tiene su propio progreso, mapa, medallas, refuerzo y diploma.
- Cada niño crea su jugador con su nombre y un animal. Varios hermanos pueden compartir el mismo dispositivo.
- La pregunta aparece en grande y se responde con el teclado de la pantalla o con el del computador.
- Si se equivoca, la app le muestra la respuesta con un dibujo de puntos y un truco, y el niño la escribe para seguir.
- Cada 10 preguntas hay un resumen con las estrellas ganadas y las multiplicaciones que mejoró. A los 15 minutos sugiere una pausa, sin obligar.
- El Mapa de las Tablas muestra cómo va cada multiplicación. Al dominar una tabla gana su medalla y al dominarlas todas, un diploma.

## Cómo decide qué preguntar

1. Cada multiplicación tiene un nivel: Nueva, Difícil, En práctica, Casi o Dominada. Sube con aciertos y vuelve a Difícil con un error.
2. Lo que falla vuelve a salir tras 3 preguntas y otra vez unas 8 después, siempre con una pista visual.
3. Mezcla retos, repasos de lo ya dominado y algunas nuevas. Si el niño viene fallando pone más fáciles; si acierta todo, más retos.
4. Solo cuenta como Dominada si la responde bien y en menos de 4 segundos. El niño nunca ve un reloj. Las dominadas vuelven cada vez más espaciadas para no olvidarlas.
5. No mete nuevas mientras haya 4 difíciles, y si falla 3 veces la misma, le muestra la pista antes de preguntarla y la espacia más para no frustrarlo.

## Tablas de dividir

- Son 64 divisiones exactas, como 56 ÷ 8 = 7. La medalla de "dividir entre 7" se gana al dominar las 8 divisiones entre 7.
- Las divisiones nuevas entran primero si el niño ya sabe la multiplicación que les corresponde (si domina 7 × 8, pronto le sale 56 ÷ 8).
- Las pistas se apoyan en la multiplicación: "Piensa en la tabla del 7: 7 × 8 = 56". Para algunas hay trucos: ÷2 es la mitad, ÷4 la mitad de la mitad, ÷8 mitad tres veces, ÷5 contar de 5 en 5 y ÷9 la primera cifra más 1.
- El dibujo de puntos muestra el reparto: 56 en 8 filas, 7 en cada una. Después recuerda la pareja: si 56 ÷ 8 = 7, entonces 56 ÷ 7 = 8.
- Detecta errores típicos: responder el número entre el que se divide, restar en vez de dividir, o quedarse corto o pasarse de grupos.
- Por defecto cuenta como rápida una respuesta de menos de 5 segundos, porque al principio dividir toma más tiempo. Se puede cambiar.

## Principios pedagógicos

- **Recordar, no reconocer:** el niño siempre escribe la respuesta. No hay opción múltiple.
- **Repetición espaciada e intercalada:** se mezclan tablas y dificultades; nunca bloques de una sola tabla.
- **Éxito alto con reto real:** la mezcla se ajusta para que acierte cerca del 80 %.
- **Rapidez medida en silencio:** sin cronómetro ni cuenta regresiva, para no generar ansiedad.
- **El error enseña:** sin vidas, sin "game over" y sin sonidos de castigo. Se elogia el esfuerzo y la mejora.
- **Comprensión además de memoria:** las pistas usan la propiedad conmutativa, dobles, ×10 menos un grupo y arreglos de puntos, y explican confusiones típicas (sumar en vez de multiplicar, correrse un grupo, cifras al revés).

## Para adultos

El botón **Para adultos** está protegido con una multiplicación de dos cifras y abre un panel que muestra cada modo (multiplicar o dividir) por separado, con:

- mapa de calor de aciertos y tiempos por multiplicación;
- las 10 mayores falencias, con sus confusiones frecuentes ("7 × 8: respondió 54, tres veces");
- refuerzo puntual: marca multiplicaciones concretas (por ejemplo 7 × 8, 9 × 7 o 6 × 9) para que salgan más seguido, más o menos 1 de cada 5 preguntas, sin dejar de practicar las demás; se activa y se quita cuando quieras;
- progreso por tabla;
- ajustes: umbral de rapidez, preguntas por ronda, tablas activas, incluir ×1 y sonido;
- copia de seguridad para pasar el progreso a otro dispositivo.

## Privacidad

No hay cuentas, servidor ni anuncios, y la app no recolecta datos. El progreso se guarda solo en el navegador del dispositivo donde se juega.

## Para desarrolladores

| Archivo | Qué contiene |
|---|---|
| `engine.js` | Motor adaptativo: niveles, reintentos, mezcla de preguntas, pistas y confusiones. Lógica pura, sin interfaz. |
| `template.html` | Interfaz: HTML, CSS y JavaScript. |
| `build.js` | Une el motor y la interfaz en `index.html`. |
| `index.html` | La app completa en un solo archivo. Es lo que publica GitHub Pages. |
| `sim.js` | Simula niños ficticios y verifica el motor. |
| `uitest.py` | Prueba la interfaz en Chromium: celular, tablet y solo teclado. |

Después de cambiar `engine.js` o `template.html`:

```bash
node build.js       # regenera index.html
node sim.js         # verifica el motor con niños simulados
python3 uitest.py   # verifica la interfaz (requiere playwright y pillow)
```

Las constantes ajustables del motor (umbral de rapidez, mezcla de preguntas, espaciado de reintentos) están al inicio de `engine.js`.
