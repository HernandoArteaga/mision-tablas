"""Prueba de la interfaz en Chromium: celular solo con el dedo, tablet y computador solo con teclado."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = HERE
SHOTS = os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)
PORT = 8765
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = f'http://127.0.0.1:{PORT}/index.html'
errors, results = [], []


def ok(cond, msg):
    results.append(('  OK    ' if cond else '  FALLA ') + msg)


READY = """() => { const vis = id => !document.getElementById(id).hidden;
  if (vis('o-round') || vis('o-medal') || vis('o-diploma')) return true;
  const c = document.getElementById('qCard'), s = document.getElementById('slot');
  return !document.getElementById('s-play').hidden && s.textContent === '?' && !c.classList.contains('good') && !c.classList.contains('fixing') && !c.classList.contains('testwrong'); }"""


def watch(page):
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'fonts' not in m.text else None)


CODE_JS = "(() => { const d = new Date(); return String(d.getHours() * 100 + d.getMinutes()).padStart(4, '0'); })()"


def papa_code(pg):
    return pg.evaluate(CODE_JS)


def qinfo(page):
    a, b = int(page.inner_text('#qa')), int(page.inner_text('#qb'))
    op = page.inner_text('#qop')
    return a, b, (a // b if op == '÷' else a * b), op


def wrong_val(a, b, ans, op):
    if op == '÷':
        return ans + 1 if ans < 9 else ans - 1
    v = a * b + b
    return v if v < 100 else a * b - b


def play_touch(page, n, wrong_at, shots=None):
    answered, round_seen = 0, False
    while answered < n:
        if page.is_visible('#o-round'):
            if shots and not round_seen:
                page.wait_for_timeout(450); page.screenshot(path=shots['round'])
            round_seen = True
            page.tap('#roundGo'); page.wait_for_function(READY); continue
        if page.is_visible('#o-medal'):
            page.tap('#medalOk'); page.wait_for_function(READY); continue
        a, b, ans, op = qinfo(page)
        if answered == wrong_at:
            for d in str(wrong_val(a, b, ans, op)): page.tap(f'.key[data-k="{d}"]')
            page.tap('.key[data-k="ok"]')
            page.wait_for_timeout(450)
            circles = len(page.query_selector_all('#fixBox svg circle'))
            dots = a if op == '÷' else a * b
            fb, qt = page.locator('#feedback').bounding_box(), page.locator('#qText').bounding_box()
            ok(fb['y'] + fb['height'] <= qt['y'] + 1, f'El mensaje ({fb["height"]:.0f} px de alto) no se encima con la pregunta')
            ok(page.is_visible('#fixBox') and str(ans) in page.inner_text('.copy-tip') and circles == dots,
               f'Error en {a} {op} {b}: muestra {ans}, un arreglo de {circles} puntos y pide copiarlo')
            if shots: page.screenshot(path=shots['fix'])
            for d in str(ans): page.tap(f'.key[data-k="{d}"]')
        else:
            for d in str(ans): page.tap(f'.key[data-k="{d}"]')
            page.tap('.key[data-k="ok"]')
        answered += 1
        page.wait_for_function(READY, timeout=8000)
    return round_seen


with sync_playwright() as pw:
    br = pw.chromium.launch()

    # ---------- Celular, solo con el dedo ----------
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); watch(page)
    page.goto(URL); page.wait_for_timeout(700)
    ok(page.is_visible('#s-new'), 'Sin perfiles, abre "crear tu jugador"')
    page.screenshot(path=f'{SHOTS}/p1-new.png')
    page.tap('#newName'); page.keyboard.type('Sofía')
    page.tap('.avatar-opt[data-a="🦉"]')
    page.tap('#newForm button[type=submit]'); page.wait_for_timeout(400)
    ok(page.inner_text('#homeHello') == '¡Hola, Sofía!', 'Crea el perfil y saluda por el nombre')
    page.screenshot(path=f'{SHOTS}/p2-home.png')
    page.tap('#btnPlay'); page.wait_for_function(READY)
    page.screenshot(path=f'{SHOTS}/p3-play.png')
    timer_like = page.evaluate("() => /\\d+:\\d\\d|segundos|cronómetro|tiempo restante/i.test(document.getElementById('s-play').innerText)")
    ok(not timer_like, 'En la práctica no hay cronómetro ni cuenta regresiva visible')
    seen = play_touch(page, 14, 3, {'fix': f'{SHOTS}/p4-fix.png', 'round': f'{SHOTS}/p5-round.png'})
    ok(seen, 'Al completar 10 preguntas aparece el fin de ronda y se puede seguir')
    stars = page.inner_text('#hudStarsN')
    page.tap('#btnExit'); page.wait_for_timeout(300)
    page.reload(); page.wait_for_timeout(700)
    ok(page.is_visible('#s-home') and page.inner_text('#homeStars') == stars and page.inner_text('#homeHello') == '¡Hola, Sofía!',
       f'Tras recargar sigue el perfil de Sofía con sus {stars} estrellas')
    page.tap('#btnMap'); page.wait_for_timeout(300)
    cells = len(page.query_selector_all('#mapGrid .cell[data-k]'))
    page.tap('#mapGrid .cell[data-k="7x8"]')
    ok(cells == 64 and '7 × 8' in page.inner_text('#mapInfo'), f'Mapa con {cells} casillas; al tocar una dice cómo va')
    page.screenshot(path=f'{SHOTS}/p6-map.png', full_page=True)
    page.tap('#s-map .back'); page.wait_for_timeout(200)
    page.tap('#btnAdult'); page.wait_for_timeout(300)
    good = papa_code(page)
    wrong = '%04d' % ((int(good) + 37) % 2400)
    page.tap('#gateInput'); page.keyboard.type(wrong); page.tap('#gateForm button[type=submit]')
    masked = page.evaluate("getComputedStyle(document.getElementById('gateInput')).webkitTextSecurity")
    ok(page.is_visible('#o-gate') and 'Clave incorrecta' in page.inner_text('#gateErr') and masked == 'disc',
       f'La clave de Papá se escribe oculta y rechaza {wrong} (la hora es {good})')
    page.fill('#gateInput', papa_code(page)); page.tap('#gateForm button[type=submit]'); page.wait_for_timeout(400)
    weak = page.inner_text('#weakList')
    ok(page.is_visible('#s-adult') and '×' in weak, 'Con la respuesta correcta entra al panel, que lista las falencias')
    page.screenshot(path=f'{SHOTS}/p7-adult.png', full_page=True)
    overflow = page.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1')
    ok(not overflow, 'Panel del adulto sin desplazamiento horizontal en celular')
    with page.expect_download() as dinfo:
        page.tap('#btnBackup')
    ok(dinfo.value.suggested_filename.startswith('mision-tablas-copia-'), f'Fuera de Claude, "Guardar copia" descarga {dinfo.value.suggested_filename}')
    for k in ['7x8', '9x7', '6x9', '6x8']:
        page.tap(f'#boostGrid .pc[data-k="{k}"]'); page.wait_for_timeout(120)
    note = page.inner_text('#setBoostNote').replace('\xa0', ' ')
    ok(page.get_attribute('#setBoost', 'aria-checked') == 'true' and all(t in note for t in ['6 × 8', '6 × 9', '7 × 8', '9 × 7']),
       f'Al marcar 4 multiplicaciones, el refuerzo se activa: "{note}"')
    page.tap('#boostGrid .pc[data-k="9x7"]'); page.wait_for_timeout(120)
    page.tap('#boostGrid .pc[data-k="9x7"]'); page.wait_for_timeout(120)
    page.tap('#setBoost'); page.wait_for_timeout(150)
    off_ok = page.get_attribute('#setBoost', 'aria-checked') == 'false' and 'Apagado' in page.inner_text('#setBoostNote')
    page.tap('#setBoost'); page.wait_for_timeout(150)
    ok(off_ok and len(page.query_selector_all('#boostGrid .pc[aria-pressed="true"]')) == 4,
       'Se puede desmarcar una, y el interruptor lo apaga y prende sin perder las marcadas')
    page.locator('#boostPanel').screenshot(path=f'{SHOTS}/p8-boost.png')
    page.tap('#s-adult .back'); page.wait_for_timeout(250)
    page.reload(); page.wait_for_timeout(600)
    hb = page.inner_text('#homeBoost').replace('\xa0', ' ') if page.is_visible('#homeBoost') else ''
    ok('6 × 8' in hb and '9 × 7' in hb, f'Tras recargar, el inicio muestra "{hb}"')
    page.screenshot(path=f'{SHOTS}/p9-home-boost.png')
    ctx.close()

    # ---------- Tablet horizontal ----------
    ctx = br.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True)
    page = ctx.new_page(); watch(page)
    page.goto(URL); page.wait_for_timeout(500)
    page.tap('#newName'); page.keyboard.type('Juan'); page.tap('#newForm button[type=submit]'); page.wait_for_timeout(300)
    page.tap('#btnPlay'); page.wait_for_function(READY)
    play_touch(page, 2, 99)
    page.screenshot(path=f'{SHOTS}/t1-play.png')
    a, b, ans, op = qinfo(page)
    for d in str(wrong_val(a, b, ans, op)): page.tap(f'.key[data-k="{d}"]')
    page.tap('.key[data-k="ok"]'); page.wait_for_timeout(500)
    page.screenshot(path=f'{SHOTS}/t2-fix.png')
    ctx.close()

    # ---------- Computador, solo con teclado ----------
    ctx = br.new_context(viewport={'width': 1280, 'height': 800})
    page = ctx.new_page(); watch(page)
    page.goto(URL); page.wait_for_timeout(500)
    tabs = 0
    while page.evaluate('document.activeElement.id') != 'newName' and tabs < 15:
        page.keyboard.press('Tab'); tabs += 1
    page.keyboard.type('Ana'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    tabs = 0
    while page.evaluate('document.activeElement.id') != 'btnPlay' and tabs < 15:
        page.keyboard.press('Tab'); tabs += 1
    ok(tabs < 15, f'Con Tab se llega al botón "¡A jugar!" ({tabs} pulsaciones)')
    page.keyboard.press('Enter'); page.wait_for_function(READY)
    answered, rounds, fixed = 0, 0, False
    while answered < 12:
        if page.is_visible('#o-round'):
            page.wait_for_function("() => document.activeElement && document.activeElement.id === 'roundGo'")
            rounds += 1; page.keyboard.press('Enter')
            page.wait_for_function("() => document.getElementById('o-round').hidden"); page.wait_for_function(READY); continue
        if page.is_visible('#o-medal'):
            page.wait_for_function("() => document.activeElement && document.activeElement.id === 'medalOk'")
            page.keyboard.press('Enter'); page.wait_for_function("() => document.getElementById('o-medal').hidden"); page.wait_for_function(READY); continue
        a, b, ans, op = qinfo(page)
        if answered == 5:
            page.keyboard.type(str(wrong_val(a, b, ans, op))); page.keyboard.press('Enter'); page.wait_for_timeout(400)
            page.keyboard.type('9'); page.keyboard.press('Backspace')
            page.keyboard.type(str(ans)); fixed = True
        else:
            page.keyboard.type(str(ans)); page.keyboard.press('Enter')
        answered += 1
        page.wait_for_function(READY, timeout=8000)
    ok(answered == 12 and rounds == 1 and fixed, f'Solo con teclado: {answered} respuestas, una corrección y {rounds} fin de ronda con Enter')
    tabs = 0
    while page.evaluate('document.activeElement.id') != 'btnExit' and tabs < 10:
        page.keyboard.press('Tab'); tabs += 1
    page.keyboard.press('Enter'); page.wait_for_timeout(300)
    ok(page.is_visible('#s-home'), 'Con Tab y Enter se sale de la práctica')
    page.screenshot(path=f'{SHOTS}/d1-home.png')
    ctx.close()
    # ---------- Dos dispositivos: unir a Julieta ----------
    def new_profile(pg, name):
        pg.tap('#newName'); pg.keyboard.type(name); pg.tap('#newForm button[type=submit]'); pg.wait_for_timeout(300)

    def open_adult(pg):
        pg.tap('#btnAdult'); pg.wait_for_timeout(250)
        pg.fill('#gateInput', papa_code(pg)); pg.tap('#gateForm button[type=submit]'); pg.wait_for_timeout(300)

    count_js = "() => JSON.parse(localStorage.getItem('mision-tablas-v1')).profiles.length"
    devs = []
    for name, n in [('Julieta', 4), ('julieta', 3)]:
        c = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = c.new_page(); watch(pg); pg.goto(URL); pg.wait_for_timeout(500)
        new_profile(pg, name)
        pg.tap('#btnPlay'); pg.wait_for_function(READY); play_touch(pg, n, 99)
        pg.tap('#btnExit'); pg.wait_for_timeout(300)
        devs.append((c, pg, int(pg.inner_text('#homeStars'))))
    (c1, p1, s1), (c2, p2, s2) = devs
    open_adult(p1); p1.tap('#btnCode'); p1.wait_for_timeout(600)
    code = p1.input_value('#codeOut')
    p1.locator('#syncPanel').screenshot(path=f'{SHOTS}/p10-sync.png')
    open_adult(p2); p2.fill('#codeIn', code); p2.tap('#btnMerge'); p2.wait_for_timeout(600)
    msg = p2.inner_text('#syncMsg')
    p2.tap('#s-adult .back'); p2.wait_for_timeout(250)
    stars = int(p2.inner_text('#homeStars'))
    ok('Listo' in msg and stars == s1 + s2 and p2.evaluate(count_js) == 1,
       f'Código del celular ({len(code)} caracteres) pegado en el laptop: {s1} + {s2} estrellas = {stars}, un solo perfil')
    open_adult(p2); p2.fill('#codeIn', code); p2.tap('#btnMerge'); p2.wait_for_timeout(500)
    p2.tap('#s-adult .back'); p2.wait_for_timeout(250)
    ok(int(p2.inner_text('#homeStars')) == s1 + s2, 'Pegar el mismo código otra vez no duplica nada')
    p2.tap('#btnSwitch'); p2.wait_for_timeout(200); p2.tap('#btnNewProfile'); p2.wait_for_timeout(200)
    new_profile(p2, 'JULIETA')
    ok(p2.evaluate(count_js) == 1 and 'julieta' in p2.inner_text('#homeHello').lower(), 'Crear "JULIETA" otra vez entra al perfil que ya existe')
    c1.close(); c2.close()

    # ---------- Tablas de dividir ----------
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); watch(page); page.goto(URL); page.wait_for_timeout(500)
    new_profile(page, 'Mateo')
    page.tap('#s-home .mode[data-op="div"]'); page.wait_for_timeout(200)
    ok('divisiones dominadas' in page.inner_text('#homeCountLabel') and page.get_attribute('#s-home .mode[data-op="div"]', 'aria-pressed') == 'true',
       'En el inicio se elige Dividir: "0 de 64 divisiones dominadas"')
    page.screenshot(path=f'{SHOTS}/v1-home.png')
    page.tap('#btnPlay'); page.wait_for_function(READY)
    q_ok = page.inner_text('#qop') == '÷' and int(page.inner_text('#qa')) % int(page.inner_text('#qb')) == 0
    page.screenshot(path=f'{SHOTS}/v2-play.png')
    seen = play_touch(page, 12, 2, {'fix': f'{SHOTS}/v3-fix.png', 'round': f'{SHOTS}/v4-round.png'})
    ok(q_ok and seen, 'Pregunta "56 ÷ 8 = ?" con resultado exacto; 12 respuestas y fin de ronda')
    stars = page.inner_text('#hudStarsN')
    page.tap('#btnExit'); page.wait_for_timeout(250); page.reload(); page.wait_for_timeout(600)
    ok(page.get_attribute('#s-home .mode[data-op="div"]', 'aria-pressed') == 'true' and page.inner_text('#homeStars') == stars,
       f'Tras recargar sigue en Dividir con sus {stars} estrellas')
    page.tap('#btnMap'); page.wait_for_timeout(250)
    page.tap('#mapGrid .cell[data-k="8x7"]')
    info = page.inner_text('#mapInfo')
    ok(page.inner_text('#mapGrid .cell.h') == '÷' and '56 ÷ 8' in info and 'Dividir entre 7' in page.inner_text('#tableList'),
       f'Mapa de divisiones: "{info}"')
    page.screenshot(path=f'{SHOTS}/v5-map.png', full_page=True)
    page.tap('#s-map .back'); page.wait_for_timeout(200)
    open_adult(page)
    div_fast = page.get_attribute('#setFast button[data-v="5000"]', 'aria-pressed') == 'true'
    weak_div = '÷' in page.inner_text('#weakList')
    page.screenshot(path=f'{SHOTS}/v6-adult.png', full_page=True)
    page.tap('#adOps button[data-op="mul"]'); page.wait_for_timeout(200)
    ok(div_fast and weak_div and page.get_attribute('#setFast button[data-v="4000"]', 'aria-pressed') == 'true'
       and page.inner_text('#adKpis').startswith('0 / 64'),
       'Panel para adultos por modo: dividir (falencias con ÷, rapidez 5 s) y multiplicar (sin jugar, 4 s)')
    ctx.close()

    # ---------- Test definitivo: ganar y perder ----------
    def run_test(pg, wrong_at):
        pg.tap('#btnTest'); pg.wait_for_timeout(250)
        pg.tap('#tsGo'); pg.wait_for_function(READY)
        n = int(pg.inner_text('#testCount').split(' de ')[1]); done = 0
        while done < n:
            a, b, ans, op = qinfo(pg)
            pg.keyboard.type(str(wrong_val(a, b, ans, op) if done in wrong_at else ans)); pg.keyboard.press('Enter')
            done += 1
            if done < n: pg.wait_for_function(READY, timeout=8000)
        return n

    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); watch(page); page.goto(URL); page.wait_for_timeout(500)
    new_profile(page, 'Julieta')
    ok('locked' in page.get_attribute('#btnTest', 'class') and 'llevas 0' in page.inner_text('#testSub'), 'El test aparece cerrado mientras no domine las 64')
    page.tap('#btnTest'); page.wait_for_timeout(250)
    gate_title = page.inner_text('#gateTitle')
    page.fill('#gateInput', papa_code(page)); page.tap('#gateForm button[type=submit]'); page.wait_for_timeout(300)
    ok(gate_title == 'Abrir el test definitivo' and page.is_visible('#o-tstart'), 'Con candado, la clave de Papá abre el test (solo este intento)')
    page.tap('#tsNo'); page.wait_for_timeout(200)
    ok('locked' in page.get_attribute('#btnTest', 'class'), 'Si no lo empieza, el test sigue con candado')
    open_adult(page)
    page.tap('#setTestAlways'); page.wait_for_timeout(150)
    page.fill('#setPrize', 'Un helado con Papá'); page.dispatch_event('#setPrize', 'change'); page.wait_for_timeout(150)
    page.tap('#s-adult .back'); page.wait_for_timeout(250)
    sub = page.inner_text('#testSub')
    ok('locked' not in page.get_attribute('#btnTest', 'class') and 'Un helado con Papá' in sub, f'Abierto por el adulto, muestra el premio: "{sub}"')
    page.screenshot(path=f'{SHOTS}/w1-home.png')
    n = run_test(page, {7, 30})
    page.wait_for_selector('#o-prize:not([hidden])', timeout=8000)
    page.wait_for_timeout(2600)
    page.screenshot(path=f'{SHOTS}/w2-prize.png')
    title = page.get_attribute('#prizeTitle', 'aria-label')
    song = page.evaluate("document.documentElement.dataset.song || ''")
    ok(title == '¡Test definitivo superado!' and 'Un helado con Papá' in page.inner_text('#tPrize') and page.is_visible('#prizeTicket') and song == 'playing',
       f'Test de {n} con 2 errores: celebración, vale "{page.inner_text("#tPrize")}" y canción sonando')
    page.tap('#prizeOk'); page.wait_for_timeout(300)
    ok(page.is_visible('#btnTicket') and page.evaluate("!document.documentElement.dataset.song"), 'Al cerrar se detiene la canción y el inicio muestra el premio por reclamar')
    page.tap('#btnTicket'); page.wait_for_timeout(400)
    page.tap('#prizeClaim'); page.wait_for_timeout(250)
    page.fill('#gateInput', papa_code(page)); page.tap('#gateForm button[type=submit]'); page.wait_for_timeout(300)
    stamp = page.is_visible('#tStamp')
    page.tap('#prizeOk'); page.wait_for_timeout(300)
    ok(stamp and not page.is_visible('#btnTicket') and 'Récord: 62 de 64' in page.inner_text('#testSub'), 'Papá lo marca como entregado (con la barrera para adultos); queda el récord 62 de 64')
    ctx.close()

    ctx = br.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True)
    page = ctx.new_page(); watch(page); page.goto(URL); page.wait_for_timeout(500)
    new_profile(page, 'Ana')
    open_adult(page)
    for t in ['3', '4', '5', '6', '7', '8', '9']: page.tap(f'#setTables .tchip[data-n="{t}"]'); page.wait_for_timeout(60)
    page.tap('#setTestAlways'); page.wait_for_timeout(100)
    page.tap('#s-adult .back'); page.wait_for_timeout(250)
    n = run_test(page, {0, 3, 6})
    page.wait_for_selector('#o-test:not([hidden])', timeout=8000)
    page.screenshot(path=f'{SHOTS}/w3-fail.png')
    lines = page.inner_text('#testLines')
    ok(page.inner_text('#testScore') == f'{n - 3} de {n}' and 'Para practicar' in lines and not page.is_visible('#o-prize'),
       f'Test de {n} con 3 errores no gana: "{lines.splitlines()[0]}"')
    page.tap('#testPractice'); page.wait_for_function(READY)
    ok(page.is_visible('#roundDots') and not page.is_visible('#testBar'), '"Practicar ahora" vuelve a la práctica normal')
    ctx.close()
    br.close()

srv.terminate()


def montage(files, out, width, cols, crop_h=None):
    ims = []
    for f in files:
        im = Image.open(f).convert('RGB')
        if crop_h: im = im.crop((0, 0, im.width, min(im.height, crop_h)))
        im = im.resize((width, int(im.height * width / im.width)))
        ims.append(im)
    rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
    H = sum(max(i.height for i in r) for r in rows) + 12 * (len(rows) + 1)
    canvas = Image.new('RGB', (cols * width + 12 * (cols + 1), H), (120, 120, 120))
    y = 12
    for r in rows:
        x = 12
        for im in r:
            canvas.paste(im, (x, y)); x += width + 12
        y += max(i.height for i in r) + 12
    canvas.save(out)


S = lambda n: os.path.join(SHOTS, n)
montage([S('p2-home.png'), S('p4-fix.png'), S('p5-round.png'), S('p7-adult.png'), S('t2-fix.png')], S('m-check.png'), 330, 5, crop_h=1688)
montage([S('p1-new.png'), S('p2-home.png'), S('p3-play.png'), S('p4-fix.png'), S('p5-round.png'), S('p6-map.png')], S('m-phone.png'), 300, 6, crop_h=1688)
adult = Image.open(S('p7-adult.png'))
segs = []
seg_h = 1688
for i in range(0, min(adult.height, seg_h * 4), seg_h):
    p = S(f'p7-seg{i // seg_h}.png'); adult.crop((0, i, adult.width, min(adult.height, i + seg_h))).save(p); segs.append(p)
montage(segs + [S('t1-play.png'), S('t2-fix.png')], S('m-other.png'), 300, len(segs) + 2)
print('\n'.join(results))
real = [e for e in errors if 'ERR_TUNNEL' not in e and 'ERR_NAME' not in e]
print(f'\nErrores de consola: {len(errors) - len(real)} de fuentes sin internet (esperado aquí); otros: {real if real else "ninguno"}')
