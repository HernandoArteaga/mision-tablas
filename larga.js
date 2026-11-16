/* Misión Tablas · División larga (BETA): "El Repartidor".
   Lógica pura del módulo, sin interfaz: arma divisiones de 3 cifras entre 1 cifra por etapa, revisa cada paso,
   clasifica los errores, lleva el dominio de cada etapa y une el progreso de varios dispositivos.
   Se carga después de engine.js y se cuelga de MT como MT.LD. */
(function (root) {
  'use strict';
  const MT = root.MT;
  if (!MT) throw new Error('larga.js necesita engine.js antes');

  const CFG = {
    GOAL: 8,            // repartos limpios seguidos (sin errores ni ayuda) para dominar una etapa
    BACK: 2,            // un reparto con errores resta 2 a la cuenta, no la borra
    EXPLAIN_EVERY: 3,   // "Explícale a Papá" cada 3 repartos
    MS_CAP: 10 * 60 * 1000,
    LOG: 40, ERRS: 60, RECENT: 12, TRIES: 4000
  };
  const PLACES = ['centenas', 'decenas', 'unidades'];
  const PLACE_ONE = ['centena', 'decena', 'unidad'];
  const PLACE_VAL = [100, 10, 1];
  const STAGES = [
    { id: 's1', n: 1, name: 'Sin canje', ex: '846 ÷ 2', tip: 'Cada cifra se reparte y no sobra nada en el camino.' },
    { id: 's2', n: 2, name: 'Con canje', ex: '451 ÷ 4', tip: 'Lo que sobra se cambia en el banco y se baja.' },
    { id: 's3', n: 3, name: 'Cero en el cociente', ex: '505 ÷ 5', tip: 'Si no alcanza para todas las cajas, les tocan 0. Y ese 0 se escribe.' },
    { id: 's4', n: 4, name: 'La primera no alcanza', ex: '136 ÷ 4', tip: 'Las centenas no alcanzan: se cambian todas y empiezas por las decenas.' },
    { id: 's5', n: 5, name: 'Solo papel', ex: 'Sin fichas, como en el cuaderno', tip: 'Tú escribes cada paso: divido, multiplico, resto y bajo.' }
  ];
  const DET = { id: 'det', name: 'Detective de errores', ex: '¿Quién tiene razón?', after: 's3' };
  const IDS = STAGES.map(s => s.id);
  // Divisores por etapa y por nivel elegido (tranquilo, normal, reto).
  const DIVS = {
    s1: { tranquilo: [2], normal: [3], reto: [4] },
    s2: { tranquilo: [2, 3, 5], normal: [4, 6], reto: [7, 8, 9] },
    s3: { tranquilo: [2, 3, 5], normal: [4, 6], reto: [7, 8, 9] },
    s4: { tranquilo: [2, 3, 4, 5], normal: [6, 7], reto: [8, 9] },
    s5: { tranquilo: [2, 3, 5], normal: [4, 6], reto: [7, 8, 9] }
  };
  const TIERS = ['tranquilo', 'normal', 'reto'];
  const FALLBACK = { s1: [846, 2], s2: [451, 4], s3: [505, 5], s4: [136, 4] };

  const ERR_TEXT = {
    corta: 'Se queda corta: deja sobrar más que el divisor',
    pasa: 'Se pasa: reparte más de lo que alcanza',
    cero: 'Olvida el 0 en el cociente',
    noalcanza: 'Reparte aunque la primera cifra no alcanza',
    resta: 'Resta mal lo que sobra',
    mult: 'Multiplica mal (en Solo papel)',
    reves: 'Escribe la respuesta al revés',
    residuo: 'Olvida o cambia el residuo',
    lectura: 'Copia mal la respuesta de arriba',
    check: 'Se equivoca al comprobar'
  };
  const REC_TEXT = {
    corta: 'Repasar Residuo con ese divisor. En el cuaderno, pregúntele: "¿lo que sobra alcanza para otra vuelta?". Lo que sobra siempre es menor que el divisor.',
    pasa: 'Repasar Residuo: buscar en la tabla el más grande que no se pase. Antes de escribir la cifra, que multiplique para comprobar.',
    cero: 'Practicar la etapa "Cero en el cociente". En el cuaderno: una cifra arriba por cada cifra que se baja, aunque sea 0.',
    noalcanza: 'Practicar "La primera no alcanza": si la primera cifra es menor que el divisor, se toman las dos primeras.',
    resta: 'Repasar restas pequeñas con canje (11 − 8, 13 − 12). El error no está en dividir sino en restar.',
    mult: 'Repasar en Multiplicar la tabla del divisor que más falla.',
    reves: 'Que estime antes de dividir y lea la fila de arriba de izquierda a derecha, con el dedo.',
    residuo: 'Que termine siempre preguntándose "¿me sobró algo?" y escriba R = …, aunque sea 0.',
    lectura: 'Que señale con el dedo la fila de arriba antes de copiar la respuesta.',
    check: 'Practicar la comprobación: divisor × respuesta + residuo = el número del principio.'
  };
  const DET_TEXT = {
    cero: 'Se le olvidó escribir el 0 arriba',
    reves: 'Escribió la respuesta al revés',
    corta: 'Le sobró más de lo que podía repartir',
    sinres: 'Se le olvidó el residuo'
  };

  /* ===== Las cuentas ===== */
  // Pasos de la división larga: en cada posición, lo que hay (cur), cuánto a cada caja (q), lo usado (prod) y lo que sobra (r).
  function steps(d, n) {
    const D = String(n).split('').map(Number);
    let rem = 0;
    return D.map((dig, i) => {
      const cur = rem * 10 + dig, q = Math.floor(cur / d), prod = q * d, r = cur - prod;
      rem = r;
      return { i: i, cur: cur, q: q, prod: prod, r: r, dig: dig };
    });
  }
  function classify(d, n) {
    if (n < 100 || n > 999 || d < 2 || d > 9) return null;
    const st = steps(d, n), q = st.map(s => s.q);
    if (q[0] === 0) return q[1] > 0 && q[2] > 0 ? 's4' : 'x';
    if (q[1] === 0 || q[2] === 0) return 's3';
    if (st[0].r === 0 && st[1].r === 0) return 's1';
    return 's2';
  }
  function build(d, n, stage, tier) {
    const st = steps(d, n), Q = Math.floor(n / d), R = n % d;
    return { d: d, n: n, D: String(n).split('').map(Number), steps: st, Q: Q, R: R, Qs: String(Q), kind: classify(d, n), stage: stage, tier: tier || 'normal', key: n + '/' + d };
  }
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  function make(stage, tier, rng, avoid) {
    rng = rng || Math.random; tier = TIERS.includes(tier) ? tier : 'normal';
    const av = new Set(avoid || []);
    const want = stage === 's5' ? pick(['s2', 's2', 's3', 's4'], rng) : stage;
    const ds = (DIVS[want === 's4' && stage === 's5' ? 's4' : stage] || DIVS.s2)[tier];
    for (let t = 0; t < CFG.TRIES; t++) {
      const d = pick(ds, rng), n = 100 + Math.floor(rng() * 900);
      if (classify(d, n) === want && !av.has(n + '/' + d)) return build(d, n, stage, tier);
    }
    const f = FALLBACK[want] || FALLBACK.s2;
    return build(f[1], f[0], stage, tier);
  }
  // Tres repartos para elegir: tranquilo, normal y reto.
  function choices(stage, rng, avoid) {
    const av = (avoid || []).slice(), out = [];
    for (const t of TIERS) { const pr = make(stage, t, rng, av); av.push(pr.key); out.push(pr); }
    return out;
  }

  /* ===== Estimar ===== */
  // Franjas de 100 en 100 donde puede caer la respuesta (de 0 hasta el cociente más grande posible con ese divisor).
  function brackets(d) {
    const k = Math.floor(Math.floor(999 / d) / 100), out = [];
    for (let i = 0; i <= k; i++) out.push([i * 100, (i + 1) * 100]);
    return out;
  }
  const bracketOf = Q => Math.floor(Q / 100);

  /* ===== Revisar ===== */
  function checkStep(prob, i, qa, ra) {
    const s = prob.steps[i];
    if (qa === s.q && ra === s.r) return { ok: true };
    if (qa > s.q) return { ok: false, type: s.q === 0 ? (i === 0 ? 'noalcanza' : 'cero') : 'pasa' };
    if (qa < s.q) return { ok: false, type: 'corta' };
    return { ok: false, type: 'resta' };
  }
  // Solo papel: cada parte por separado (q = divido, p = multiplico, r = resto).
  function checkPart(prob, i, part, v) {
    const s = prob.steps[i];
    if (part === 'q') return v === s.q ? { ok: true } : checkStep(prob, i, v, -1);
    if (part === 'p') return v === s.prod ? { ok: true } : { ok: false, type: 'mult' };
    return v === s.r ? { ok: true } : { ok: false, type: 'resta' };
  }
  function checkRead(prob, digits, ra) {
    const want = prob.Qs, got = String(digits);
    if (got === want && ra === prob.R) return { ok: true };
    if (got === want) return { ok: false, type: 'residuo' };
    const rev = want.split('').reverse().join('');
    if (rev !== want && got === rev) return { ok: false, type: 'reves' };
    return { ok: false, type: 'lectura' };
  }
  const checkCheck = (prob, v) => (v === prob.n ? { ok: true } : { ok: false, type: 'check' });

  /* ===== Progreso guardado en el perfil (p.ld) =====
     Los contadores van por dispositivo (dev) y al unir se toma el mayor de cada uno: nada se cuenta dos veces. */
  function fresh() {
    const st = {};
    for (const id of IDS) st[id] = { streak: 0, best: 0, at: 0, done: 0, n: {} };
    return { v: 1, dev: {}, st: st, errs: [], log: [], days: [], open: false, det: {}, recent: [], since: 0, est: true };
  }
  const num = v => (+v > 0 ? +v : 0);
  function ensureLD(p) {
    const L = p.ld && typeof p.ld === 'object' ? p.ld : {};
    const f = fresh();
    const dev = {};
    if (L.dev && typeof L.dev === 'object') for (const k in L.dev) {
      const x = L.dev[k] || {};
      dev[k] = { stars: num(x.stars), solved: num(x.solved), clean: num(x.clean), ms: num(x.ms), steps: num(x.steps), ok1: num(x.ok1) };
    }
    const st = {};
    for (const id of IDS) {
      const x = (L.st && L.st[id]) || {};
      const n = {};
      if (x.n && typeof x.n === 'object') for (const k in x.n) if (Array.isArray(x.n[k])) n[k] = [num(x.n[k][0]), num(x.n[k][1])];
      st[id] = { streak: num(x.streak), best: num(x.best), at: num(x.at), done: num(x.done), n: n };
    }
    const det = {};
    if (L.det && typeof L.det === 'object') for (const k in L.det) if (Array.isArray(L.det[k])) det[k] = [num(L.det[k][0]), num(L.det[k][1]), num(L.det[k][2])];
    const arr = (a, max) => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && x.at).slice(-max) : []);
    p.ld = {
      v: 1, dev: dev, st: st, det: det,
      errs: arr(L.errs, CFG.ERRS), log: arr(L.log, CFG.LOG),
      days: Array.isArray(L.days) ? L.days.filter(d => typeof d === 'string') : [],
      open: !!L.open, recent: Array.isArray(L.recent) ? L.recent.filter(k => typeof k === 'string').slice(-CFG.RECENT) : [],
      since: num(L.since), est: L.est !== false
    };
    return p;
  }
  function reset(p) { p.ld = fresh(); return p; }

  function stageIndex(id) { return IDS.indexOf(id); }
  function isOpen(p, id) {
    const L = p.ld;
    if (L.open || id === 's1') return true;
    if (id === 'det') return !!L.st[DET.after].done;
    const i = stageIndex(id);
    return i > 0 && !!L.st[IDS[i - 1]].done;
  }
  // La etapa en la que va: la primera abierta que aún no domina (o la última).
  function current(p) {
    for (const id of IDS) if (isOpen(p, id) && !p.ld.st[id].done) return id;
    return IDS[IDS.length - 1];
  }
  function totals(p) {
    const t = { stars: 0, solved: 0, clean: 0, ms: 0, steps: 0, ok1: 0, cases: 0, casesOk: 0 };
    for (const k in p.ld.dev) for (const f in p.ld.dev[k]) t[f] += p.ld.dev[k][f];
    for (const k in p.ld.det) { t.cases += p.ld.det[k][0]; t.casesOk += p.ld.det[k][1]; t.stars += p.ld.det[k][2]; }
    return t;
  }
  function stageTries(st) { let a = 0, c = 0; for (const k in st.n) { a += st.n[k][0]; c += st.n[k][1]; } return { tries: a, clean: c }; }
  function summary(p) {
    return STAGES.map(s => {
      const st = p.ld.st[s.id], n = stageTries(st);
      return Object.assign({}, s, { streak: st.streak, best: st.best, done: st.done, open: isOpen(p, s.id), tries: n.tries, clean: n.clean, goal: CFG.GOAL });
    });
  }
  const ymd = t => MT.ymd(t);
  /* Guarda un reparto terminado.
     out: { prob, clean, assisted, ok1, steps, errs: [{ i, t }], ms, stars } */
  function record(p, dev, out, now) {
    now = now || Date.now();
    const L = p.ld, prob = out.prob, sid = prob.stage, st = L.st[sid];
    const good = !!out.clean && !out.assisted;
    st.streak = good ? st.streak + 1 : Math.max(0, st.streak - CFG.BACK);
    st.best = Math.max(st.best, st.streak);
    st.at = now;
    const nn = st.n[dev] || (st.n[dev] = [0, 0]);
    nn[0]++; if (good) nn[1]++;
    let newlyDone = false;
    if (!st.done && st.streak >= CFG.GOAL) { st.done = now; newlyDone = true; }
    const c = L.dev[dev] || (L.dev[dev] = { stars: 0, solved: 0, clean: 0, ms: 0, steps: 0, ok1: 0 });
    c.solved++; if (good) c.clean++;
    c.stars += num(out.stars); c.ms += Math.min(num(out.ms), CFG.MS_CAP);
    c.steps += num(out.steps); c.ok1 += num(out.ok1);
    (out.errs || []).forEach((e, k) => L.errs.push({ at: now + k, n: prob.n, d: prob.d, i: e.i, t: e.t }));
    L.errs = L.errs.slice(-CFG.ERRS);
    L.log.push({ at: now, n: prob.n, d: prob.d, s: sid, ok: good ? 1 : 0, a: out.assisted ? 1 : 0, ms: Math.min(num(out.ms), CFG.MS_CAP) });
    L.log = L.log.slice(-CFG.LOG);
    const day = ymd(now);
    if (!L.days.includes(day)) L.days.push(day);
    L.recent = L.recent.concat(prob.key).slice(-CFG.RECENT);
    L.since++;
    const explain = L.since % CFG.EXPLAIN_EVERY === 0;
    return { newlyDone: newlyDone, streak: st.streak, goal: CFG.GOAL, good: good, explain: explain };
  }
  function recordDet(p, dev, ok, stars) {
    const x = p.ld.det[dev] || (p.ld.det[dev] = [0, 0, 0]);
    x[0]++; if (ok) x[1]++; x[2] += num(stars);
  }
  function addStars(p, dev, n) {
    const c = p.ld.dev[dev] || (p.ld.dev[dev] = { stars: 0, solved: 0, clean: 0, ms: 0, steps: 0, ok1: 0 });
    c.stars += num(n);
  }
  // Une el progreso de b dentro de a (dos dispositivos con el mismo jugador).
  function merge(a, b) {
    ensureLD(a); ensureLD(b);
    const A = a.ld, B = b.ld;
    const maxObj = (x, y, fields) => {
      const r = {};
      for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) {
        if (fields) { r[k] = {}; for (const f of fields) r[k][f] = Math.max((x[k] || {})[f] || 0, (y[k] || {})[f] || 0); }
        else r[k] = (x[k] || [0, 0, 0]).map((v, i) => Math.max(v, ((y[k] || [])[i]) || 0));
      }
      return r;
    };
    const dev = maxObj(A.dev, B.dev, ['stars', 'solved', 'clean', 'ms', 'steps', 'ok1']);
    const st = {};
    for (const id of IDS) {
      const x = A.st[id], y = B.st[id], newer = x.at >= y.at ? x : y;
      const done = [x.done, y.done].filter(Boolean);
      st[id] = { streak: newer.streak, best: Math.max(x.best, y.best), at: Math.max(x.at, y.at), done: done.length ? Math.min.apply(null, done) : 0, n: maxObj(x.n, y.n) };
      for (const k in st[id].n) st[id].n[k] = st[id].n[k].slice(0, 2);
    }
    const union = (u, v, idf, max) => {
      const seen = new Set(), out = [];
      u.concat(v).sort((m, n) => m.at - n.at).forEach(e => { const id = idf(e); if (!seen.has(id)) { seen.add(id); out.push(e); } });
      return out.slice(-max);
    };
    A.dev = dev; A.st = st;
    A.det = maxObj(A.det, B.det);
    A.errs = union(A.errs, B.errs, e => `${e.at}|${e.n}|${e.d}|${e.i}|${e.t}`, CFG.ERRS);
    A.log = union(A.log, B.log, e => `${e.at}|${e.n}|${e.d}`, CFG.LOG);
    A.days = Array.from(new Set(A.days.concat(B.days))).sort();
    A.open = A.open || B.open;
    A.est = A.est && B.est;
    return a;
  }

  /* ===== Para el adulto ===== */
  function errStats(p, last) {
    const list = p.ld.errs.slice(-(last || 30)), count = {};
    list.forEach(e => { count[e.t] = (count[e.t] || 0) + 1; });
    return Object.keys(count).map(t => ({ t: t, n: count[t], text: ERR_TEXT[t] || t, ex: list.filter(e => e.t === t).slice(-1)[0] }))
      .sort((x, y) => y.n - x.n);
  }
  function recommend(p) {
    const s = errStats(p, 20);
    const cur = STAGES[stageIndex(current(p))];
    if (!p.ld.log.length) return `Empezar por la etapa ${cur.n}, "${cur.name}". Cada reparto toma un minuto y medio más o menos.`;
    if (!s.length) return `Va muy bien. Que siga con "${cur.name}" y se anime con el reto.`;
    return REC_TEXT[s[0].t] || `Que siga con "${cur.name}".`;
  }

  /* ===== Detective de errores ===== */
  // Arma un caso: un reparto bien hecho y otro con un error típico. Devuelve los dos trabajos para dibujarlos.
  function makeCase(p, rng) {
    rng = rng || Math.random;
    const types = ['cero', 'reves', 'corta', 'sinres'];
    const type = pick(types, rng);
    let prob = null;
    for (let t = 0; t < 60 && !prob; t++) {
      const stage = type === 'cero' ? 's3' : 's2', tier = pick(TIERS, rng);
      const pr = make(stage, tier, rng);
      const ok = type === 'cero' ? pr.steps[1].q === 0 && pr.steps[2].q > 0
        : type === 'reves' ? pr.Qs !== pr.Qs.split('').reverse().join('')
          : type === 'corta' ? pr.steps[2].q > 0
            : pr.R > 0;
      if (ok) prob = pr;
    }
    if (!prob) prob = type === 'cero' ? build(5, 505, 's3') : type === 'reves' ? build(4, 451, 's2') : type === 'corta' ? build(4, 451, 's2') : build(4, 451, 's2');
    let wq = prob.Qs, wr = prob.R, wsteps = prob.steps.map(s => Object.assign({}, s)), gap = null, check = '';
    const d = prob.d, n = prob.n;
    if (type === 'cero') {
      wq = prob.Qs.replace('0', ''); gap = 1;
      check = `Compruébalo: ${d} × ${wq}${wr ? ' + ' + wr : ''} = ${d * +wq + wr}, no ${n}.`;
    } else if (type === 'reves') {
      wq = prob.Qs.split('').reverse().join('');
      check = `Compruébalo: ${d} × ${wq}${wr ? ' + ' + wr : ''} = ${d * +wq + wr}, no ${n}.`;
    } else if (type === 'corta') {
      const s = wsteps[2]; s.q -= 1; s.prod = s.q * d; s.r = s.cur - s.prod;
      wq = String(prob.Q - 1); wr = s.r;
      check = `Le sobraron ${wr} y había ${d} cajas: alcanzaba otra vuelta. Lo que sobra tiene que ser menor que ${d}.`;
    } else {
      wr = null;
      check = `Compruébalo: ${d} × ${prob.Qs} = ${d * prob.Q}, no ${n}. Faltan los ${prob.R} que sobraron.`;
    }
    const wrongIsT = rng() < 0.5;
    const others = types.filter(t => t !== type);
    const opts = [type, pick(others, rng)];
    const third = others.filter(t => t !== opts[1]);
    opts.push(pick(third, rng));
    // Mezcla las opciones.
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = opts[i]; opts[i] = opts[j]; opts[j] = t; }
    return {
      prob: prob, type: type, check: check,
      wrong: { q: wq, r: wr, steps: wsteps, gap: gap },
      wrongName: wrongIsT ? 'Tomás' : 'Lía', rightName: wrongIsT ? 'Lía' : 'Tomás',
      options: opts.map(t => ({ t: t, text: DET_TEXT[t] }))
    };
  }

  MT.LD = {
    CFG, PLACES, PLACE_ONE, PLACE_VAL, STAGES, DET, TIERS, ERR_TEXT, REC_TEXT, DET_TEXT,
    steps, classify, build, make, choices, brackets, bracketOf, checkStep, checkPart, checkRead, checkCheck,
    fresh, ensure: ensureLD, reset, isOpen, current, totals, summary, record, recordDet, addStars, merge,
    errStats, recommend, makeCase
  };
  if (MT.HOOKS) { MT.HOOKS.ensure.push(ensureLD); MT.HOOKS.merge.push(merge); }
  if (typeof module !== 'undefined' && module.exports) module.exports = MT.LD;
})(typeof window !== 'undefined' ? window : globalThis);
