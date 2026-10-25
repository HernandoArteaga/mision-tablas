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
  return !document.getElementById('s-play').hidden && s.textContent === '?' && !c.classList.contains('good') && !c.classList.contains('fixing'); }"""


def watch(page):
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'fonts' not in m.text else None)


def qnums(page):
    return int(page.inner_text('#qa')), int(page.inner_text('#qb'))


def wrong_for(a, b):
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
        a, b = qnums(page)
        if answered == wrong_at:
            for d in str(wrong_for(a, b)): page.tap(f'.key[data-k="{d}"]')
            page.tap('.key[data-k="ok"]')
            page.wait_for_timeout(450)
            circles = len(page.query_selector_all('#fixBox svg circle'))
            ok(page.is_visible('#fixBox') and str(a * b) in page.inner_text('.copy-tip') and circles == a * b,
               f'Error en {a} × {b}: muestra {a * b}, un arreglo de {circles} puntos y pide copiarlo')
            if shots: page.screenshot(path=shots['fix'])
            for d in str(a * b): page.tap(f'.key[data-k="{d}"]')
        else:
            for d in str(a * b): page.tap(f'.key[data-k="{d}"]')
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
    x, y = [int(t) for t in page.inner_text('#gateQ').split('×')]
    page.tap('#gateInput'); page.keyboard.type('1'); page.tap('#gateForm button[type=submit]')
    ok(page.is_visible('#o-gate') and 'No es correcto' in page.inner_text('#gateErr'), 'La barrera para adultos rechaza una respuesta equivocada')
    page.fill('#gateInput', str(x * y)); page.tap('#gateForm button[type=submit]'); page.wait_for_timeout(400)
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
    note = page.inner_text('#setBoostNote')
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
    hb = page.inner_text('#homeBoost') if page.is_visible('#homeBoost') else ''
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
    a, b = qnums(page)
    for d in str(wrong_for(a, b)): page.tap(f'.key[data-k="{d}"]')
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
        a, b = qnums(page)
        if answered == 5:
            page.keyboard.type(str(wrong_for(a, b))); page.keyboard.press('Enter'); page.wait_for_timeout(400)
            page.keyboard.type('9'); page.keyboard.press('Backspace')
            page.keyboard.type(str(a * b)); fixed = True
        else:
            page.keyboard.type(str(a * b)); page.keyboard.press('Enter')
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
