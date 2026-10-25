'use strict';
/* Simulación de niños ficticios para verificar el motor adaptativo. */
const MT = require('./engine.js');
const fails = [];
const out = [];
const check = (cond, msg) => { out.push((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fails.push(msg); return cond; };

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const inv = k => { const t = MT.parse(k); return MT.key(t.b, t.a); };

function simulate(kid, n, seed, sessionLen) {
  const rng = rngFrom(seed);
  let now = new Date(2026, 9, 19, 16, 0, 0).getTime();
  const p = MT.newProfile(kid.name, '🦊', now);
  let s = MT.newSession(p, now), session = 0, idx = 0;
  const log = [];
  for (let i = 0; i < n; i++) {
    if (idx >= sessionLen) { now += 86400000; s = MT.newSession(p, now); session++; idx = 0; }
    const keys = MT.universe(p.settings);
    const L1 = keys.filter(k => p.facts[k].level === 1).length;
    const pick = MT.pickNext(p, s, rng, now);
    if (!pick || !pick.key) { log.push(null); break; }
    const ans = kid.answer(pick, i, rng);
    now += ans.ms + 1500;
    const r = MT.grade(p, s, pick.key, ans.value, ans.ms, now, { kind: pick.kind, stage: pick.stage, assisted: pick.preHint });
    if (r.roundDone) MT.closeRound(s);
    log.push({ i, session, idx, key: pick.key, a: pick.a, b: pick.b, kind: pick.kind, mode: pick.mode, lb: pick.level, L1,
      ok: r.correct, level: r.level, pre: pick.preHint, sessErr: r.sessionErrors, all: r.allMastered });
    idx++;
  }
  return { p, log };
}

const right = (pk, ms) => ({ value: pk.a * pk.b, ms });
const kidA = { name: 'Falla 7×8 y 6×9', answer: pk => pk.key === '7x8' ? { value: 54, ms: 3000 } : pk.key === '6x9' ? { value: 56, ms: 3000 } : right(pk, 2500) };
const kidSlow = { name: 'Lento', answer: pk => right(pk, 6000) };
const kidFast = { name: 'Rápido', answer: pk => right(pk, 1500) };
const kidOnce = (() => { const seen = {}; return { name: 'Falla una vez', answer(pk) {
  if ((pk.key === '4x7' || pk.key === '3x8') && !seen[pk.key]) { seen[pk.key] = 1; return { value: pk.a * pk.b + 1, ms: 3000 }; }
  return right(pk, 1800);
} }; })();
const kidMood = { name: 'Por rachas', answer(pk, i, rng) {
  const pOk = i < 220 ? 0.96 : (Math.floor((i - 220) / 30) % 2 === 0 ? 0.3 : 0.98);
  return rng() < pOk ? right(pk, 2600) : { value: pk.a * pk.b + (rng() < 0.5 ? pk.b : -pk.b), ms: 4200 };
} };

const runs = {
  A: simulate(kidA, 600, 11, 60),
  slow: simulate(kidSlow, 600, 12, 60),
  fast: simulate(kidFast, 700, 13, 60),
  once: simulate(kidOnce, 400, 14, 1000),
  mood: simulate(kidMood, 820, 15, 60)
};

out.push('\n1) Un error reaparece tras 3 preguntas intermedias y otra vez unas 8 después');
{
  const L = runs.once.log;
  for (const K of ['4x7', '3x8']) {
    const pos = L.filter(e => e.key === K).map(e => e.i);
    const e0 = L.find(e => e.key === K && !e.ok);
    const j = pos.indexOf(e0.i);
    const g1 = pos[j + 1] - pos[j] - 1, g2 = pos[j + 2] - pos[j + 1] - 1;
    check(g1 >= 3 && g1 <= 4 && g2 >= 8 && g2 <= 10, `${K}: falla en la pregunta ${e0.i}; vuelve tras ${g1} intermedias y luego tras ${g2}`);
  }
  const A = runs.A.log;
  const hist = {};
  let bad = 0, total = 0;
  for (const e of A) {
    if (e.ok || (e.key !== '7x8' && e.key !== '6x9')) continue;
    const nx = A.find(x => x.i > e.i && x.key === e.key && x.session === e.session);
    if (!nx) continue;
    const gap = nx.i - e.i - 1, base = e.sessErr < 3 ? 3 : Math.min(7 + 3 * (e.sessErr - 3), 15), dev = gap - base;
    const tag = (e.sessErr < 3 ? 'normal' : 'anti-frustración') + ' +' + dev;
    hist[tag] = (hist[tag] || 0) + 1;
    total++; if (dev < 0 || dev > 2) bad++;
  }
  check(bad === 0, `Niño que siempre falla: ${total} reintentos medidos, desfase respecto al plan: ${JSON.stringify(hist)}`);
}

out.push('\n2) 7×8 y 6×9 salen bastante más que el resto, sin acaparar la sesión');
{
  const A = runs.A.log;
  // Se mide desde la sesión siguiente a la primera vez que salen (antes la app aún no sabe que fallan).
  const firstSes = Math.max(A.find(e => e.key === '7x8').session, A.find(e => e.key === '6x9').session) + 1;
  let minR = Infinity, sumR = 0, maxShare = 0, sumShare = 0, ses = 0;
  for (let sIdx = firstSes; sIdx < 10; sIdx++) {
    const L = A.filter(e => e.session === sIdx);
    const c7 = L.filter(e => e.key === '7x8').length, c6 = L.filter(e => e.key === '6x9').length;
    const other = (L.length - c7 - c6) / 62;
    minR = Math.min(minR, c7 / other, c6 / other); sumR += (c7 + c6) / 2 / other;
    const share = (c7 + c6) / L.length;
    maxShare = Math.max(maxShare, share); sumShare += share; ses++;
  }
  check(minR >= 3, `Sesiones ${firstSes + 1} a 10: cada una sale en promedio ${(sumR / ses).toFixed(1)} veces más que una multiplicación cualquiera (mínimo ${minR.toFixed(1)})`);
  check(maxShare <= 0.3, `Entre las dos ocupan en promedio ${(100 * sumShare / ses).toFixed(0)} % de la sesión (máximo ${(100 * maxShare).toFixed(0)} %)`);
  const pre = A.filter(e => e.pre).length;
  check(pre > 0, `La pista previa aparece ${pre} veces tras el tercer error de la sesión`);
}

out.push('\n3) Con respuestas siempre lentas, nada llega a Dominada');
{
  const L = runs.slow.log, p = runs.slow.p;
  const by = MT.summary(p).byLevel;
  check(L.every(e => e.level < 4), `600 respuestas lentas: niveles finales ${JSON.stringify(by)} (Nueva, Difícil, En práctica, Casi, Dominada)`);
}

out.push('\n4) Nunca la misma multiplicación ni su invertida dos veces seguidas; máx. 2 con el mismo primer factor');
for (const [name, r] of Object.entries(runs)) {
  const L = r.log;
  let rep = 0, tri = 0;
  for (let i = 1; i < L.length; i++) {
    if (L[i].key === L[i - 1].key || L[i].key === inv(L[i - 1].key)) rep++;
    if (i >= 2 && L[i].a === L[i - 1].a && L[i].a === L[i - 2].a) tri++;
  }
  check(rep === 0 && tri === 0, `${name}: ${L.length} preguntas, ${rep} repetidas o invertidas seguidas, ${tri} tríos con el mismo primer factor`);
}

out.push('\n5) Con muchos errores aumentan las fáciles; con muchos aciertos, los retos');
{
  const L = runs.mood.log.filter(e => ['reto', 'confianza', 'nueva'].includes(e.kind));
  const stat = mode => {
    const X = L.filter(e => e.mode === mode);
    return { n: X.length, easy: X.filter(e => e.lb >= 3).length / X.length, hard: X.filter(e => e.lb <= 2).length / X.length };
  };
  const low = stat('low'), base = stat('base'), high = stat('high');
  const pct = x => (100 * x).toFixed(0) + ' %';
  out.push(`  (info) En la partida simulada: tras errores ${pct(low.easy)} fáciles, normal ${pct(base.easy)}, tras aciertos ${pct(high.hard)} retos`);
  // Experimento controlado: mismo estado del niño, solo cambia cómo le ha ido en las últimas 10.
  const p0 = JSON.stringify(simulate(kidMood, 268, 15, 60).p); // a mitad de una mala racha: niveles mezclados
  const now = new Date(2026, 10, 2, 16, 0, 0).getTime();
  const rng = rngFrom(99);
  const measure = recent => {
    const p = JSON.parse(p0); p.recent = recent;
    let easy = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      const s = MT.newSession(p, now); s.asked = 99; s.hist = [];
      if (MT.pickNext(p, s, rng, now).level >= 3) easy++;
    }
    return easy / N;
  };
  const by = MT.summary(JSON.parse(p0)).byLevel;
  const eLow = measure([0, 1, 0, 0, 1, 0, 0, 0, 1, 0]), eBase = measure([1, 1, 0, 1, 1, 1, 0, 1, 1, 1]), eHigh = measure([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  check(eLow > eBase + 0.05, `Mismo estado (niveles ${JSON.stringify(by)}): con 3 de 10 aciertos salen ${pct(eLow)} fáciles; con 8 de 10, ${pct(eBase)}`);
  check(1 - eHigh > 1 - eBase + 0.05, `Con 10 de 10 aciertos salen ${pct(1 - eHigh)} retos; con 8 de 10, ${pct(1 - eBase)}`);
}

out.push('\n6) Las preguntas nunca se acaban, aunque todo esté dominado');
{
  const L = runs.fast.log;
  const at = L.findIndex(e => e && e.all);
  const after = L.slice(at + 1);
  const distinct = new Set(after.map(e => e.key)).size;
  check(at >= 0 && !L.includes(null) && after.length >= 300 && after.every(e => e.kind === 'mantenimiento' || e.kind === 'retry'),
    `Niño rápido: domina las 64 en la pregunta ${at + 1}; luego sigue ${after.length} preguntas de mantenimiento sin cortarse`);
  check(distinct >= 60, `En mantenimiento repasa ${distinct} multiplicaciones distintas`);
}

out.push('\nExtras');
{
  let viol = 0, total = 0;
  for (const r of Object.values(runs)) for (const e of r.log) if (e.lb === 0) { total++; if (e.L1 >= 4) viol++; }
  check(viol === 0, `Ninguna nueva entra con 4 o más difíciles (${total} nuevas introducidas)`);
  let warmBad = 0, warmN = 0;
  for (const r of Object.values(runs)) for (const e of r.log) if (e.session > 0 && e.idx < 3) { warmN++; if (e.lb === 1 || e.lb === 2) warmBad++; }
  check(warmBad === 0, `Calentamiento: ${warmN} preguntas de inicio de sesión, ninguna difícil`);
  let hintBad = [];
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) {
    if (a === 1 && b === 1) continue;
    const h = MT.hint(a, b), P = a * b;
    const nums = (h.full.match(/\d+/g) || []).map(Number);
    if (!nums.includes(P)) hintBad.push(`${a}×${b} sin resultado`);
    if (new RegExp('(^|[^\\d])' + P + '([^\\d]|$)').test(h.cue) && !(a === 7 && b === 8) && !(a === 8 && b === 7)) hintBad.push(`${a}×${b} pista previa revela ${P}`);
    const m = h.full.match(/(\d+) \+ (\d+) = (\d+)/); if (m && +m[1] + +m[2] !== +m[3]) hintBad.push(`${a}×${b} suma mal`);
    const m2 = h.full.match(/(\d+) − (\d+) = (\d+)/); if (m2 && +m2[1] - +m2[2] !== +m2[3]) hintBad.push(`${a}×${b} resta mal`);
  }
  check(hintBad.length === 0, `Pistas de las 80 multiplicaciones correctas y sin revelar la respuesta antes de tiempo ${hintBad.join(', ')}`);
  const c = MT.confusion;
  check(/sumar/.test(c(7, 8, 15).text) && /7 × 7/.test(c(7, 8, 49).text) && /6 × 9/.test(c(7, 8, 54).text) && /al revés/.test(c(7, 8, 65).text),
    'Confusiones: 7+8=15, 49 (un grupo), 54 (6 × 9) y 65 (cifras al revés) se detectan');
  const once = runs.once.p;
  check(MT.summary(once).mastered === 64, `Niño que falla una vez termina con ${MT.summary(once).mastered}/64 dominadas`);
  const Ap = runs.A.p;
  check(Ap.facts['7x8'].level === 1 && Ap.facts['6x9'].level === 1 && MT.summary(Ap).mastered === 62,
    `Niño A: 7×8 y 6×9 siguen en Difícil y las otras ${MT.summary(Ap).mastered} están dominadas`);
  const w = MT.weaknesses(Ap, 10);
  check(w[0] && ['7x8', '6x9'].includes(w[0].key) && w[0].confusion, `Panel: la mayor falencia es ${w[0].a} × ${w[0].b} (respondió ${w[0].confusion.answer}, ${w[0].confusion.count} veces)`);
}

console.log(out.join('\n'));
console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTodo en orden.');
process.exit(fails.length ? 1 : 0);
