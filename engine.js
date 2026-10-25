/* Misión Tablas · motor adaptativo.
   Lógica pura: no toca la interfaz. Recibe el estado del perfil y de la sesión,
   decide qué preguntar, califica y devuelve resultados. */
(function (root) {
  'use strict';

  /* ===== Constantes ajustables ===== */
  const CONFIG = {
    FAST_MS: 4000,                 // umbral de rapidez por defecto (ms)
    ROUND_SIZE: 10,                // preguntas por ronda
    MIX_BASE: { reto: 0.5, confianza: 0.3, nueva: 0.2 },
    MIX_LOW: { reto: 0.35, confianza: 0.55, nueva: 0.1 },  // aciertos recientes < 70 %
    MIX_HIGH: { reto: 0.55, confianza: 0.15, nueva: 0.3 }, // aciertos recientes > 90 %
    RECENT_WINDOW: 10,             // resultados que mira el ajuste dinámico
    RECENT_MIN: 5,                 // mínimo de resultados para ajustar
    LOW_ACC: 0.7,
    HIGH_ACC: 0.9,
    RETRY_GAPS: [3, 8],            // preguntas intermedias antes de cada reintento
    RETRY_GAPS_FRUSTRATED: [7, 15],// espaciado cuando actúa la regla anti-frustración
    FRUSTRATION_ERRORS: 3,         // errores en la misma sesión que activan la pista previa
    FRUSTRATION_STEP: 3,           // cada error extra en la sesión espacia 3 preguntas más (tope: 15)
    MIN_GAP_LEVEL_UP: 3,           // preguntas intermedias necesarias para subir de nivel
    MAX_DIFFICULT: 4,              // con 4 o más en nivel 1 no entran nuevas
    WARMUP: 3,                     // preguntas fáciles al empezar cada sesión
    MAX_SAME_FIRST: 2,             // máximo de seguidas con el mismo primer factor
    SLOW_STRIKES_TO_DROP: 2,       // aciertos lentos seguidos que bajan una Dominada a Casi
    REVIEW_BASE: 10,               // intervalo base de repaso de una Dominada (en preguntas)
    BREAK_MS: 15 * 60 * 1000,      // sugerir pausa tras 15 minutos de práctica
    SESSION_RESUME_MS: 10 * 60 * 1000,
    TIME_CAP_MS: 60 * 1000,        // tope por pregunta al sumar tiempo de práctica
    FEEDBACK_MS: 1500
  };

  const TABLES = [2, 3, 4, 5, 6, 7, 8, 9];
  const LEVELS = ['Nueva', 'Difícil', 'En práctica', 'Casi', 'Dominada'];
  const RANK = [1, 2, 5, 9, 4, 3, 6, 8, 7]; // de la estrategia más sencilla a la más exigente

  const key = (a, b) => a + 'x' + b;
  function parse(k) { const i = k.indexOf('x'); return { a: +k.slice(0, i), b: +k.slice(i + 1) }; }

  function defaultSettings() {
    return { fastMs: CONFIG.FAST_MS, tables: TABLES.slice(), includeOne: false, sound: true, roundSize: CONFIG.ROUND_SIZE };
  }
  function activeTables(st) {
    const t = (st.tables || []).filter(n => TABLES.includes(n));
    return t.length ? t.sort((x, y) => x - y) : TABLES.slice();
  }
  /* Multiplicaciones en juego: una entra si al menos uno de sus factores es una tabla activa. */
  function universe(st) {
    const F = st.includeOne ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : TABLES;
    const act = activeTables(st);
    const out = [];
    for (const a of F) for (const b of F) if (act.includes(a) || act.includes(b)) out.push(key(a, b));
    return out;
  }
  /* Dificultad natural: ×1 → ×2 y ×5 → ×3, ×4, ×9 y cuadrados → 6, 7 y 8 combinados. */
  function group(a, b) {
    if (a === 1 || b === 1) return 0;
    if (a === 2 || a === 5 || b === 2 || b === 5) return 1;
    if (a === 3 || a === 4 || a === 9 || b === 3 || b === 4 || b === 9 || a === b) return 2;
    return 3;
  }

  function newFact() {
    return { level: 0, attempts: 0, correct: 0, times: [], wrong: [], lastSeen: -1, lastAt: 0, okDays: [], slow: 0, reviews: 0 };
  }
  function newProfile(name, avatar, now) {
    now = now || Date.now();
    return ensure({
      v: 1,
      id: 'p' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      name: name, avatar: avatar, createdAt: now,
      settings: defaultSettings()
    });
  }
  function ensure(p) {
    p.settings = Object.assign(defaultSettings(), p.settings || {});
    p.settings.tables = activeTables(p.settings);
    p.facts = p.facts || {};
    for (const k of universe(p.settings)) if (!p.facts[k]) p.facts[k] = newFact();
    for (const f of ['recent', 'lastKeys', 'medals', 'days']) if (!Array.isArray(p[f])) p[f] = [];
    for (const f of ['q', 'answered', 'stars', 'bestStreak', 'practiceMs', 'masteredAll']) if (typeof p[f] !== 'number') p[f] = 0;
    return p;
  }
  function resetProgress(p) {
    const keep = { v: 1, id: p.id, name: p.name, avatar: p.avatar, createdAt: p.createdAt, settings: p.settings };
    for (const k of Object.keys(p)) delete p[k];
    return ensure(Object.assign(p, keep));
  }

  /* ===== Sesión ===== */
  function freshRound() { return { answered: 0, correct: 0, stars: 0, ups: 0, mastered: [] }; }
  function newSession(p, now) {
    now = now || Date.now();
    return {
      startedAt: now, last: now, asked: 0, streak: 0,
      hist: (p.lastKeys || []).slice(-2),
      retries: [], errors: {}, frustrated: {}, needHint: {},
      activeMs: 0, breakAt: CONFIG.BREAK_MS,
      round: freshRound()
    };
  }
  function closeRound(s) { const r = s.round; s.round = freshRound(); return r; }
  function ackBreak(s) { s.breakAt = s.activeMs + CONFIG.BREAK_MS; }

  /* ===== Reglas anti-monotonía =====
     relax 0: todas; 1: sin la del primer factor; 2: tampoco la invertida.
     Nunca la misma multiplicación dos veces seguidas. */
  function allowed(k, hist, relax) {
    const n = hist.length;
    if (!n) return true;
    const t = parse(k);
    const last = hist[n - 1];
    if (last === k) return false;
    if (relax < 2 && last === key(t.b, t.a)) return false;
    if (relax < 1 && n >= CONFIG.MAX_SAME_FIRST) {
      let same = 0;
      for (let i = n - CONFIG.MAX_SAME_FIRST; i < n; i++) if (parse(hist[i]).a === t.a) same++;
      if (same >= CONFIG.MAX_SAME_FIRST) return false;
    }
    return true;
  }

  /* ===== Utilidades ===== */
  function avgOkMs(f) { let s = 0, n = 0; for (const t of f.times) if (t[1]) { s += t[0]; n++; } return n ? s / n : null; }
  function isSlow(f, fastMs) { const m = avgOkMs(f); return m !== null && m > fastMs; }
  function wpick(items, weights, rng) {
    let t = 0;
    for (const w of weights) t += w;
    if (!(t > 0)) return items.length ? items[Math.floor(rng() * items.length)] : null;
    let r = rng() * t;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
    return items[items.length - 1];
  }
  function anyOf(arr, rng) { return arr.length ? arr[Math.floor(rng() * arr.length)] : null; }
  function ymd(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ===== Tipos de pregunta ===== */
  // Reto: niveles 1 a 3, más probable cuanto más bajo el nivel y más falladas o lentas.
  // Si el niño viene fallando mucho, las Difíciles ya vuelven por reintento: el reto se apoya en las intermedias.
  function pickReto(p, avail, rng, mode) {
    const c = avail.filter(k => { const L = p.facts[k].level; return L >= 1 && L <= 3; });
    if (!c.length) return null;
    const fastMs = p.settings.fastMs;
    return wpick(c, c.map(k => {
      const f = p.facts[k];
      const base = mode === 'low' ? (f.level === 1 ? 1.5 : 3) : (f.level === 1 ? 6 : f.level === 2 ? 3 : 1.6);
      const err = f.attempts ? (f.attempts - f.correct) / f.attempts : 0;
      const slow = isSlow(f, fastMs) ? 1.5 : 1;
      const fresh = p.q - f.lastSeen - 1 < CONFIG.MIN_GAP_LEVEL_UP ? 0.05 : 1; // recién vista: no sumaría nivel
      return base * (1 + 2 * err) * slow * fresh;
    }), rng);
  }
  // Repaso espaciado: cada repaso rápido duplica el intervalo; las lentas y los días sin verla lo acortan.
  function reviewNeed(p, f, now) {
    const interval = CONFIG.REVIEW_BASE * Math.pow(2, Math.min(f.reviews, 5)) * (isSlow(f, p.settings.fastMs) ? 0.5 : 1);
    const days = f.lastAt ? Math.max(0, Math.floor((now - f.lastAt) / 864e5)) : 0;
    return ((p.q - f.lastSeen) / interval) * (1 + days);
  }
  // Confianza: Dominadas que más necesitan repaso; si no hay, Casi, nuevas fáciles o En práctica.
  function pickConfianza(p, avail, rng, now, blocked) {
    const dom = avail.filter(k => p.facts[k].level === 4);
    if (dom.length) {
      const sc = dom.map(k => [k, reviewNeed(p, p.facts[k], now)]).sort((x, y) => y[1] - x[1]).slice(0, 3);
      return wpick(sc.map(x => x[0]), sc.map(x => x[1] + 0.01), rng);
    }
    const stalest = L => avail.filter(k => p.facts[k].level === L)
      .sort((x, y) => p.facts[x].lastSeen - p.facts[y].lastSeen).slice(0, 4);
    let c = stalest(3);
    if (c.length) return anyOf(c, rng);
    if (!blocked) {
      c = avail.filter(k => { if (p.facts[k].level !== 0) return false; const t = parse(k); return group(t.a, t.b) <= 1; });
      if (c.length) return anyOf(c, rng);
    }
    c = stalest(2);
    return c.length ? anyOf(c, rng) : null;
  }
  // Nueva: nivel 0, en orden de dificultad natural. Bloqueada con 4 o más difíciles.
  function pickNueva(p, avail, rng, blocked) {
    if (blocked) return null;
    const c = avail.filter(k => p.facts[k].level === 0);
    if (!c.length) return null;
    let g = 9;
    for (const k of c) { const t = parse(k); g = Math.min(g, group(t.a, t.b)); }
    return anyOf(c.filter(k => { const t = parse(k); return group(t.a, t.b) === g; }), rng);
  }
  function mixFor(p) {
    const r = p.recent.slice(-CONFIG.RECENT_WINDOW);
    if (r.length < CONFIG.RECENT_MIN) return ['base', CONFIG.MIX_BASE];
    const acc = r.reduce((x, y) => x + y, 0) / r.length;
    if (acc < CONFIG.LOW_ACC) return ['low', CONFIG.MIX_LOW];
    if (acc > CONFIG.HIGH_ACC) return ['high', CONFIG.MIX_HIGH];
    return ['base', CONFIG.MIX_BASE];
  }

  /* ===== Elegir la siguiente pregunta ===== */
  function pickNext(p, s, rng, now) {
    rng = rng || Math.random;
    now = now || Date.now();
    const keys = universe(p.settings);
    const inU = new Set(keys);
    s.retries = s.retries.filter(r => inU.has(r.key));
    const pend = new Set(s.retries.map(r => r.key));
    const blocked = keys.filter(k => p.facts[k].level === 1).length >= CONFIG.MAX_DIFFICULT;
    const maint = keys.every(k => p.facts[k].level === 4);
    const mm = mixFor(p), mode = mm[0], mix = mm[1];
    const make = (k, kind, stage, drawn) => {
      const t = parse(k);
      return {
        key: k, a: t.a, b: t.b,
        kind: maint && kind !== 'retry' ? 'mantenimiento' : kind,
        stage: stage || 0, mode: mode, drawn: drawn || null,
        level: p.facts[k].level,
        preHint: !!(s.frustrated[k] && s.needHint[k])
      };
    };
    for (let relax = 0; relax <= 2; relax++) {
      const ok = k => allowed(k, s.hist, relax);
      // 1. Reintentos a los que les llegó el turno (si chocan con la anti-monotonía, esperan una pregunta).
      const due = s.retries.filter(r => r.due <= p.q).sort((x, y) => x.due - y.due);
      for (const r of due) if (ok(r.key)) return make(r.key, 'retry', r.stage);
      const avail = keys.filter(k => !pend.has(k) && ok(k));
      // 2. Calentamiento.
      if (s.asked < CONFIG.WARMUP) {
        const k = pickConfianza(p, avail, rng, now, blocked);
        if (k) return make(k, 'warmup');
      }
      // 3. Sorteo con la mezcla del momento; si el tipo está vacío o bloqueado, el siguiente.
      const drawn = wpick(['reto', 'confianza', 'nueva'], [mix.reto, mix.confianza, mix.nueva], rng);
      for (const kind of [drawn].concat(['reto', 'confianza', 'nueva'].filter(x => x !== drawn))) {
        const k = kind === 'reto' ? pickReto(p, avail, rng, mode)
          : kind === 'confianza' ? pickConfianza(p, avail, rng, now, blocked)
            : pickNueva(p, avail, rng, blocked);
        if (k) return make(k, kind, 0, drawn);
      }
    }
    // Último recurso (universo diminuto): cualquiera distinta de la anterior.
    const last = s.hist[s.hist.length - 1];
    const rest = keys.filter(k => k !== last);
    return make(anyOf(rest.length ? rest : keys, rng), 'reto');
  }

  /* ===== Calificar una respuesta ===== */
  function grade(p, s, k, answer, ms, now, opts) {
    opts = opts || {};
    now = now || Date.now();
    const f = p.facts[k] || (p.facts[k] = newFact());
    const t = parse(k), a = t.a, b = t.b;
    const P = a * b, q = p.q;
    const correct = answer === P;
    const fast = correct && ms <= p.settings.fastMs;
    const prev = f.level, first = f.attempts === 0;
    const gap = f.lastSeen < 0 ? Infinity : q - f.lastSeen - 1;
    const assisted = !!opts.assisted;
    let level = prev;

    if (correct) {
      if (first) level = fast ? 3 : 2;
      else if (prev === 4) {
        if (fast) { f.slow = 0; f.reviews++; }
        else if (++f.slow >= CONFIG.SLOW_STRIKES_TO_DROP) { level = 3; f.slow = 0; f.reviews = 0; }
      } else if (gap >= CONFIG.MIN_GAP_LEVEL_UP) {
        level = fast ? Math.min(4, prev + 1) : Math.max(prev, Math.min(3, prev + 1));
      }
      if (assisted && level > prev) level = Math.min(level, Math.max(prev, 2)); // con pista previa, máximo nivel 2
      if (level === 4 && prev !== 4) { f.reviews = 0; f.slow = 0; }
    } else {
      level = 1; f.slow = 0; f.reviews = 0;
    }
    f.level = level;

    // Reintentos
    const stage = opts.kind === 'retry' ? (opts.stage || 1) : 0;
    s.retries = s.retries.filter(r => r.key !== k);
    if (!correct) {
      s.errors[k] = (s.errors[k] || 0) + 1;
      if (s.errors[k] >= CONFIG.FRUSTRATION_ERRORS) { s.frustrated[k] = true; s.needHint[k] = true; }
      const extra = s.errors[k] - CONFIG.FRUSTRATION_ERRORS;
      const g0 = s.frustrated[k]
        ? Math.min(CONFIG.RETRY_GAPS_FRUSTRATED[0] + CONFIG.FRUSTRATION_STEP * extra, CONFIG.RETRY_GAPS_FRUSTRATED[1])
        : CONFIG.RETRY_GAPS[0];
      s.retries.push({ key: k, due: q + g0 + 1, stage: 1 });
    } else {
      s.needHint[k] = false;
      if (stage === 1) {
        const g = s.frustrated[k] ? CONFIG.RETRY_GAPS_FRUSTRATED : CONFIG.RETRY_GAPS;
        s.retries.push({ key: k, due: q + g[1] + 1, stage: 2 });
      }
    }

    // Estadísticas
    f.attempts++;
    if (correct) f.correct++;
    f.times.push([Math.round(ms), correct ? 1 : 0]);
    if (f.times.length > 5) f.times.shift();
    if (!correct) { f.wrong.push(answer); if (f.wrong.length > 12) f.wrong.shift(); }
    f.lastSeen = q;
    f.lastAt = now;
    const day = ymd(now);
    if (correct && f.okDays[f.okDays.length - 1] !== day) { f.okDays.push(day); if (f.okDays.length > 6) f.okDays.shift(); }
    if (!p.days.includes(day)) p.days.push(day);
    p.q++;
    p.answered++;
    p.recent.push(correct ? 1 : 0);
    if (p.recent.length > CONFIG.RECENT_WINDOW) p.recent.shift();
    s.hist.push(k);
    if (s.hist.length > 3) s.hist.shift();
    p.lastKeys = s.hist.slice(-2);
    s.asked++;
    s.last = now;
    const spent = Math.min(ms, CONFIG.TIME_CAP_MS) + CONFIG.FEEDBACK_MS;
    s.activeMs += spent;
    p.practiceMs += spent;

    // Estrellas y racha
    let stars = 0;
    if (correct) {
      s.streak++;
      if (s.streak > p.bestStreak) p.bestStreak = s.streak;
      stars = 1 + (s.streak % 10 === 0 ? 5 : s.streak % 5 === 0 ? 2 : 0);
    } else s.streak = 0;
    p.stars += stars;

    // Ronda
    const R = s.round;
    R.answered++;
    if (correct) R.correct++;
    R.stars += stars;
    const up = correct && level > prev;
    if (up) R.ups++;
    const mastered = level === 4 && prev !== 4;
    if (mastered) R.mastered.push(k);

    // Medallas y maestría total
    const newMedals = [];
    let allMastered = false;
    if (mastered) {
      const keys = universe(p.settings);
      for (const n of new Set([a, b])) {
        if (!p.settings.tables.includes(n) || p.medals.includes(n)) continue;
        const ks = keys.filter(x => { const u = parse(x); return u.a === n || u.b === n; });
        if (ks.length && ks.every(x => p.facts[x].level === 4)) { p.medals.push(n); newMedals.push(n); }
      }
      if (!p.masteredAll && keys.every(x => p.facts[x].level === 4)) { p.masteredAll = now; allMastered = true; }
    }

    return {
      key: k, a: a, b: b, product: P, answer: answer, correct: correct, fast: fast, first: first,
      prev: prev, level: level, up: up, mastered: mastered, stars: stars, streak: s.streak,
      assisted: assisted, retryStage: stage, sessionErrors: s.errors[k] || 0,
      newMedals: newMedals, allMastered: allMastered,
      confusion: correct ? null : confusion(a, b, answer),
      roundDone: R.answered >= p.settings.roundSize,
      breakDue: s.activeMs >= s.breakAt
    };
  }

  /* ===== Pistas ===== */
  function strategy(m, n) {
    const P = m * n;
    switch (m) {
      case 1: return { full: `Cualquier número por 1 da el mismo número: ${P}.`, cue: 'Cualquier número por 1 da el mismo número…' };
      case 2: return { full: `Es el doble de ${n}: ${n} + ${n} = ${P}.`, cue: `Es el doble de ${n}: ${n} + ${n}…` };
      case 5: return { full: `Es la mitad de ×10: ${n} × 10 = ${10 * n}, y la mitad es ${P}.`, cue: `Piensa en ${n} × 10 = ${10 * n}. ¿Cuál es la mitad?` };
      case 9: return { full: `Es ×10 menos un grupo: ${10 * n} − ${n} = ${P}. ¡Sus cifras suman 9!`, cue: `Piensa en ${n} × 10 = ${10 * n} y quítale ${n}…` };
      case 4: return { full: `Es el doble del doble: ${n} → ${2 * n} → ${P}.`, cue: `El doble del doble: ${n} → ${2 * n} → …` };
      case 3: return { full: `Es el doble y un grupo más: ${2 * n} + ${n} = ${P}.`, cue: `El doble de ${n} es ${2 * n}. Súmale ${n} más…` };
      case 6: return { full: `Es ×5 y un grupo más: ${5 * n} + ${n} = ${P}.`, cue: `${n} × 5 = ${5 * n}. Súmale un grupo más de ${n}…` };
      case 8: return { full: `Doble, doble, doble: ${n} → ${2 * n} → ${4 * n} → ${P}.`, cue: `Doble, doble, doble: ${n} → ${2 * n} → ${4 * n} → …` };
      default: return { full: `Es ×5 más ×2: ${5 * n} + ${2 * n} = ${P}.`, cue: `${n} × 5 = ${5 * n} y ${n} × 2 = ${2 * n}. Súmalos…` };
    }
  }
  function hint(a, b) {
    if ((a === 7 && b === 8) || (a === 8 && b === 7)) {
      return { full: '5, 6, 7, 8 → 56 = 7 × 8. ¡Es una escalera de números!', cue: 'Recuerda la escalera: 5, 6, 7, 8…', swap: null };
    }
    const m = RANK.indexOf(a) <= RANK.indexOf(b) ? a : b;
    const n = m === a ? b : a;
    const st = strategy(m, n);
    let full = st.full;
    if (a === b && a >= 6 && a <= 8) full += ` Es un cuadrado: ${a} filas de ${a}.`;
    const swap = m === b && a !== b ? `${a} × ${b} es lo mismo que ${b} × ${a}. ¡Si sabes una, sabes la otra!` : null;
    return { full: full, cue: st.cue, swap: swap };
  }

  /* ===== Confusiones típicas ===== */
  function confusion(a, b, ans) {
    const P = a * b;
    if (typeof ans !== 'number' || !isFinite(ans) || ans === P) return null;
    if (ans === a + b) return { type: 'suma', text: `${a} + ${b} = ${ans}: eso es sumar. Multiplicar es juntar ${a} filas de ${b}.` };
    if (ans === P - b) return { type: 'grupo', text: `${ans} es ${a - 1} × ${b}: te faltó una fila de ${b}.` };
    if (ans === P + b) return { type: 'grupo', text: `${ans} es ${a + 1} × ${b}: te sobró una fila de ${b}.` };
    if (ans === P - a) return { type: 'grupo', text: `${ans} es ${a} × ${b - 1}: te faltó una columna de ${a}.` };
    if (ans === P + a) return { type: 'grupo', text: `${ans} es ${a} × ${b + 1}: te sobró una columna de ${a}.` };
    if (P >= 10) {
      const rev = +String(P).split('').reverse().join('');
      if (rev !== P && ans === rev) return { type: 'cifras', text: `Escribiste las cifras al revés: es ${P}, no ${ans}.` };
    }
    const pairs = [];
    for (let x = 2; x <= 9; x++) for (let y = x; y <= 9; y++) if (x * y === ans) pairs.push([x, y]);
    if (pairs.length) {
      const share = pr => (pr.includes(a) ? 1 : 0) + (pr.includes(b) ? 1 : 0);
      pairs.sort((u, v) => share(v) - share(u));
      return { type: 'otra', text: `${ans} es ${pairs[0][0]} × ${pairs[0][1]}. ¡Esas dos se confunden mucho!` };
    }
    return null;
  }

  /* ===== Resúmenes ===== */
  function summary(p) {
    const keys = universe(p.settings);
    const by = [0, 0, 0, 0, 0];
    for (const k of keys) by[p.facts[k].level]++;
    return { total: keys.length, mastered: by[4], byLevel: by, maintenance: by[4] === keys.length };
  }
  function tables(p) {
    const keys = universe(p.settings);
    return activeTables(p.settings).map(n => {
      const ks = keys.filter(k => { const t = parse(k); return t.a === n || t.b === n; });
      return { n: n, done: ks.filter(k => p.facts[k].level === 4).length, total: ks.length, medal: p.medals.includes(n) };
    });
  }
  function topWrong(f) {
    const c = {};
    let best = null;
    for (const w of f.wrong) { c[w] = (c[w] || 0) + 1; if (best === null || c[w] > c[best]) best = w; }
    return best !== null && c[best] >= 2 ? { answer: best, count: c[best] } : null;
  }
  function weaknesses(p, limit) {
    const fastMs = p.settings.fastMs;
    return universe(p.settings).map(k => {
      const f = p.facts[k];
      if (!f.attempts) return null;
      const acc = f.correct / f.attempts;
      const avg = avgOkMs(f);
      const slowness = avg ? Math.max(0, avg / fastMs - 1) : 0;
      const score = (1 - acc) * 3 + Math.min(slowness, 2) + (f.level === 1 ? 1 : f.level === 2 ? 0.4 : 0);
      const t = parse(k);
      return { key: k, a: t.a, b: t.b, level: f.level, attempts: f.attempts, acc: acc, avg: avg, score: score, confusion: topWrong(f) };
    }).filter(x => x && x.score > 0.3).sort((x, y) => y.score - x.score).slice(0, limit || 10);
  }
  function dayStreak(p, now) {
    const set = new Set(p.days);
    const d = new Date(now || Date.now());
    d.setHours(12, 0, 0, 0);
    const today = set.has(ymd(d));
    if (!today) { d.setDate(d.getDate() - 1); if (!set.has(ymd(d))) return { n: 0, today: false }; }
    let n = 0;
    while (set.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
    return { n: n, today: today };
  }

  const MT = {
    CONFIG, TABLES, LEVELS, key, parse, universe, group, defaultSettings, newFact, newProfile, ensure, resetProgress,
    newSession, closeRound, ackBreak, allowed, pickNext, grade, hint, confusion,
    summary, tables, weaknesses, avgOkMs, dayStreak, ymd
  };
  root.MT = MT;
  if (typeof module !== 'undefined' && module.exports) module.exports = MT;
})(typeof window !== 'undefined' ? window : globalThis);
