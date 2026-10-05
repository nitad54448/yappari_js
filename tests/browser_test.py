"""Drives index.html in headless Chromium (file://). Usage: python3 tests/browser_test.py [screenshot dir]"""
import os, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/yappari_shots'
os.makedirs(OUT, exist_ok=True)
logs = []
def shot(pg, name): pg.screenshot(path=os.path.join(OUT, name + '.png'))
def status(pg): return pg.inner_text('#status-msg')
def contrib(pg, on):
    """Show contributions on or off with the checkbox of the Model tab, where it lives (#contrib-model)."""
    pg.evaluate("Y.app.showTab('model')")
    (pg.check if on else pg.uncheck)('#contrib-model')
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto('file://' + os.path.join(ROOT, 'index.html'))
    pg.wait_for_timeout(500)
    print('workers:', pg.evaluate('Y.pool.usingWorkers()'), pg.evaluate('Y.pool.size()'), '|', status(pg))
    shot(pg, '0_start')
    # menus follow the situation: with no data and no circuit only reading, the demo and help are available
    def menu_state(name):
        pg.click('[data-menu="%s"]' % name)
        r = pg.eval_on_selector_all('#menu-pop button', 'bs => bs.map(b => [b.textContent, b.getAttribute("aria-disabled") === "true", b.title])')
        pg.keyboard.press('Escape')
        return r
    items = [m for n in ('file', 'data', 'analysis') for m in menu_state(n)]
    print('no data: available', [m[0] for m in items if not m[1]], '| greyed out: %d' % sum(1 for m in items if m[1]))
    print('  Fit button disabled:', pg.evaluate("document.getElementById('btn-fit').disabled"), '|', pg.get_attribute('#btn-fit', 'title'))
    # read a 3-column file through the real menu and file chooser
    tmp = '/tmp/yappari_cell.dat'
    with open(tmp, 'w') as fh:
        fh.write('Freq /Hz, Zr , Zi ; Name: test\n')
        for k in range(40):
            f = 10 ** (6 - 8 * k / 39); w = 2 * 3.141592653589793 * f
            z = 20 + 1000 / complex(1, w * 1000 * 1e-6)
            fh.write('%.6E\t%.6E\t%.6E\n' % (f, z.real, z.imag))
    pg.click('[data-menu="file"]')
    with pg.expect_file_chooser() as fc:
        pg.click('#menu-pop button >> nth=0')
    fc.value.set_files(tmp)
    pg.wait_for_timeout(300)
    print('read file:', status(pg))
    # the example files through the real menus and dialogs
    FILES = os.path.join(ROOT, 'files')
    def read_menu(index, path):
        pg.click('[data-menu="file"]')
        with pg.expect_file_chooser() as fc:
            pg.click('#menu-pop button >> nth=%d' % index)
        fc.value.set_files(path); pg.wait_for_timeout(300)
        return status(pg)
    print('MFLI ZView menu:', read_menu(2, os.path.join(FILES, 'MFLI_Zview_txt_imps_0_sample_00000.txt')))
    print('3 columns on the ZView file:', read_menu(0, os.path.join(FILES, 'MFLI_Zview_txt_imps_0_sample_00000.txt')))
    print('table on Z_MFLI:', read_menu(4, os.path.join(FILES, 'Z_MFLI.txt')))
    print('VersaStudio menu:', read_menu(3, os.path.join(FILES, 'type_VersaStudio.par')))
    print('MFLI csv menu (generated file):', read_menu(1, '/tmp/yappari_mfli_generated.csv'))
    print('MFLI csv menu (sample, incomplete):', read_menu(1, os.path.join(FILES, 'mfli_imps_csv.txt')))
    pg.click('[data-menu="file"]'); pg.click('#menu-pop button >> nth=5'); pg.wait_for_timeout(200)
    with pg.expect_file_chooser() as fc:
        pg.click('#dlg button:has-text("Load definition")')
    fc.value.set_files(os.path.join(FILES, 'custom_hp4192a.xml')); pg.wait_for_timeout(300)
    print('dialog after loading the XML: header=%r label=%s sep=%s' % (pg.input_value('#f_header'), pg.input_value('#f_label_length'), pg.input_value('#f_separator')))
    shot(pg, '0_custom_dialog')
    with pg.expect_file_chooser() as fc:
        pg.click('#dlg button:has-text("Choose data files")')
    fc.value.set_files(os.path.join(FILES, 'hp4192a.txt')); pg.wait_for_timeout(300)
    print('custom hp4192a:', status(pg))
    rdf = lambda f: open(os.path.join(FILES, f), newline='').read()
    print('drop XML + data:', pg.evaluate('''async (t) => { await Y.cmd.readFiles([new File([t.x], 'Z_MFLI_datafile_example_template.xml'), new File([t.d], 'Z_MFLI.txt')], 'auto');
        return document.getElementById('status-msg').textContent; }''', {'x': rdf('Z_MFLI_datafile_example_template.xml'), 'd': rdf('Z_MFLI.txt')}))
    print('drop hp4192a alone:', pg.evaluate('''async (t) => { await Y.cmd.readFiles([new File([t], 'hp4192a.txt')], 'auto');
        return document.getElementById('status-msg').textContent; }''', rdf('hp4192a.txt')))
    pg.evaluate("Y.cmd.runCommand('select>>^Z_MFLI_449')"); pg.wait_for_timeout(300); shot(pg, '0_zmfli_nyq')
    pg.evaluate("Y.cmd.runCommand('select>>^hp4192a_')"); pg.evaluate("Y.app.showTab('zr')"); pg.wait_for_timeout(300); shot(pg, '0_hp_zr')
    pg.evaluate("Y.cmd.runCommand('select>>^MFLI_Zview')"); pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(300); shot(pg, '0_mfli_nyq')
    # demo spectra through the command line
    pg.fill('#cmdline', 'demo'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(400)
    print('datasets:', pg.evaluate('Y.state.S.datasets.length'), 'circuit:', pg.evaluate('Y.state.S.model.cdc'))
    pg.evaluate("""() => { const S = Y.state.S; Y.state.selectIds([S.datasets[0].id]);
      const v = {R1: 60, R2: 1e4, Q1: 3e-10, Q1_n: 0.9, R3: 3e4, Q2: 1e-6, Q2_n: 0.8};
      Object.keys(v).forEach(n => Y.state.setParam(n, v[n])); ['Q1_n', 'Q2_n'].forEach(n => Y.state.setFit(n, true)); }""")
    pg.evaluate("Y.app.showSide('fit')"); pg.click('#btn-fit'); pg.wait_for_timeout(100)
    pg.wait_for_function('!Y.state.S.busy', timeout=30000)
    print('single fit:', status(pg))
    print('  values:', pg.evaluate("(() => { const d = Y.state.first(); return Object.keys(d.p).map(n => n + '=' + d.p[n].toPrecision(4) + ' ±' + (d.stats.se[n] || 0).toFixed(2) + '%').join(', '); })()"))
    shot(pg, '1_single_nyq')
    # wheel over a parameter changes it
    before = pg.evaluate('Y.state.first().p.R2')
    pg.evaluate("Y.app.showSide('params')"); pg.hover('#param-list .prow[data-name="R2"] .pv'); pg.mouse.wheel(0, -100); pg.wait_for_timeout(100)
    print('wheel R2: %.4g -> %.4g' % (before, pg.evaluate('Y.state.first().p.R2')))
    pg.evaluate('Y.cmd.cloneTo(true)')
    pg.evaluate("Y.app.showSide('datasets')"); pg.focus('#ds-list'); pg.keyboard.press('Control+a'); pg.wait_for_timeout(100)
    t0 = time.time(); pg.evaluate("Y.app.showSide('fit')"); pg.click('#btn-fit'); pg.wait_for_timeout(100)
    pg.wait_for_function('!Y.state.S.busy', timeout=60000)
    print('batch fit (%.2f s wall):' % (time.time() - t0), status(pg))
    shot(pg, '2_all_nyq')
    for tab in ['zr', 'bode', 'd3']:
        pg.evaluate("Y.app.showTab('%s')" % tab); pg.wait_for_timeout(400); shot(pg, '3_' + tab)
    # Model tab: select R3, add a capacitor in parallel, undo, bad code
    pg.click('[data-tab="model"]'); pg.wait_for_timeout(200)
    pg.click('#schematic .el[data-path="2.0"]')
    pg.click('[data-mode="p"]'); pg.click('#palette [data-kind="C"]')
    print('after palette:', pg.evaluate('Y.state.S.model.cdc'), '|', pg.inner_text('#model-hint'))
    shot(pg, '4_model')
    pg.click('#node-undo'); print('after undo:', pg.evaluate('Y.state.S.model.cdc'))
    pg.fill('#cdc', 'R(RQ'); pg.press('#cdc', 'Enter'); print('bad code message:', pg.inner_text('#cdc-msg'))
    pg.fill('#cdc', 'R(RQ)(RQ)'); pg.press('#cdc', 'Enter')
    pg.click('[data-tab="params"]'); pg.wait_for_timeout(200); shot(pg, '5_params')
    print('limits header:', pg.inner_text('#limits thead').replace('\t', ' | '))
    # global fit: first 6 datasets, R local, Q shared
    pg.evaluate("""() => { const S = Y.state.S; Y.state.selectIds(S.datasets.slice(0, 6).map(d => d.id));
      ['R1', 'R2', 'R3'].forEach(n => Y.state.setShared(n, false)); }""")
    pg.evaluate('void Y.cmd.globalFit()'); pg.wait_for_timeout(200); pg.wait_for_function('!Y.state.S.busy', timeout=60000)
    print('global:', status(pg))
    # mask by zooming the Nyquist plot
    pg.evaluate("Y.app.showTab('nyq')"); pg.evaluate('Y.state.selectIds([Y.state.S.datasets[0].id])'); pg.wait_for_timeout(300)
    bb = pg.locator('#nyq-host canvas').bounding_box()
    pg.mouse.move(bb['x'] + bb['width'] * 0.55, bb['y'] + bb['height'] * 0.15); pg.mouse.down()
    pg.mouse.move(bb['x'] + bb['width'] * 0.95, bb['y'] + bb['height'] * 0.9, steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    pg.evaluate('void Y.cmd.inView(false)'); pg.wait_for_timeout(300)
    if pg.evaluate('document.getElementById("dlg").open'): pg.keyboard.press('Escape')
    print('mask:', status(pg))
    shot(pg, '6_masked')
    print('masked points drawn (hollow):', pg.evaluate("Y.plots._plots.nyq.series.filter(s => s.masked).map(s => s.x.length)"))
    print('params file:', pg.evaluate("Y.writers.paramsText(Y.state.selected(), Y.state.names(), {cdc: Y.state.S.model.cdc, method: 'm', weight: 'w'}).split('\\n')[2].slice(0, 120)"))
    print('report html length:', pg.evaluate('Y.report.build(Y.state.selected()).length'))
    pg.click('[data-menu="data"]'); pg.wait_for_timeout(150); shot(pg, '7_menu'); pg.keyboard.press('Escape')
    pg.evaluate("Y.cmd.runCommand('help')"); pg.wait_for_timeout(150); shot(pg, '8_help'); pg.keyboard.press('Escape')
    proj = pg.evaluate('Y.writers.projectJSON(Y.state.S)')
    pg.evaluate('(t) => Y.state.loadProject(JSON.parse(t))', proj)
    print('project reload:', pg.evaluate('Y.state.S.datasets.length'), pg.evaluate('Y.state.S.model.cdc'), 'stats kept:', pg.evaluate('Y.state.S.datasets.filter(d => d.stats).length'))
    # ---- help, undo, contributions, labels, fit status, measured sigma, DRT, Z-HIT, dark mode
    pg.fill('#cmdline', 'help'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(300)
    print('help from the command line opens a dialog:', pg.evaluate('document.getElementById("dlg").open')); pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    pg.evaluate("Y.cmd.runCommand('select>>^demo_00$')"); pg.wait_for_timeout(100)
    z0 = pg.evaluate('Y.state.first().zr[5]')
    pg.fill('#cmdline', 'rndz>>5'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(100)
    z1 = pg.evaluate('Y.state.first().zr[5]')
    pg.fill('#cmdline', 'undo'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(100)
    print('undo: %.7g -> %.7g -> %.7g |' % (z0, z1, pg.evaluate('Y.state.first().zr[5]')), status(pg))
    contrib(pg, True); pg.evaluate("Y.app.showTab('nyq')")
    pg.fill('#cmdline', 'label>>1k'); pg.press('#cmdline', 'Enter'); pg.fill('#cmdline', 'label>>10'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(300)
    print('labels:', status(pg)); shot(pg, 'a_contrib_nyq')
    pg.evaluate("Y.app.showTab('zi')"); pg.wait_for_timeout(300); shot(pg, 'a_contrib_zi')
    pg.click('[data-tab="model"]'); pg.wait_for_timeout(300); shot(pg, 'a_contrib_model')
    pg.uncheck('#contrib-model')
    print('fit status:', pg.inner_text('#param-stats').replace('\n', ' | '))
    pg.evaluate("""() => { const d = Y.state.first(); const sr = Array.from(d.zr, (v, k) => 0.01 * Math.hypot(d.zr[k], d.zi[k]) * (k < 30 ? NaN : 1));
        Y.state.addDatasets([{ name: 'with_sigma', f: d.f, zr: d.zr, zi: d.zi, sr: sr, si: sr, p: d.p, fit: d.fit }]); Y.state.setSetting('useSigma', true); }""")
    pg.evaluate("Y.app.showSide('fit')"); pg.click('#btn-fit'); pg.wait_for_timeout(100); pg.wait_for_function('!Y.state.S.busy', timeout=30000)
    print('sigma fit:', status(pg))
    print('  stats:', pg.inner_text('#param-stats').replace('\n', ' | '))
    pg.evaluate("Y.app.showTab('zr')"); pg.wait_for_timeout(300); shot(pg, 'a_sigma_zr')
    pg.evaluate("Y.state.setSetting('useSigma', false)")
    pg.evaluate("Y.cmd.runCommand('select>>^demo_00$')"); pg.click('[data-tab="drt"]'); pg.wait_for_timeout(600)
    print('DRT:', pg.inner_text('#drt-peaks').replace('\n', ' | ')[:420])
    shot(pg, 'b_drt')
    pg.click('#drt-search'); pg.wait_for_function('document.getElementById("scan-msg") && !/Computing/.test(document.getElementById("scan-msg").textContent)', timeout=60000); pg.wait_for_timeout(200)
    print('search:', pg.inner_text('#scan-msg')); shot(pg, 'b_search')
    pg.click('#dlg button:has-text("Use this value")'); pg.wait_for_timeout(400); print('after search:', status(pg))
    pg.select_option('#drt-method', 'gold'); pg.wait_for_timeout(3000); print('gold:', pg.inner_text('#drt-peaks').split('\n')[-1][:160])
    pg.select_option('#drt-method', 'tikhonov'); pg.wait_for_timeout(300)
    pg.set_viewport_size({'width': 1100, 'height': 650})
    pg.evaluate("Y.cmd.runCommand('select>>^demo_0[0-3]$')"); pg.click('[data-tab="drt"]'); pg.wait_for_timeout(800)
    print('DRT curves drawn for 4 selected:', pg.evaluate("Y.drtTab.plots()[1].series.length"))
    with pg.expect_download() as dl:
        pg.click('#drt-all')
    lines = open(dl.value.path()).read().split('\n')
    print('Save DRT:', dl.value.suggested_filename, '|', status(pg)); print('  file:', ' / '.join(lines[:6])[:300])
    lay = pg.evaluate("""() => { const st = document.querySelector('.stage').getBoundingClientRect(), ft = document.querySelector('.status').getBoundingClientRect(),
        pk = document.querySelector('.drt-peaks').getBoundingClientRect();
        return { pageScrolls: document.scrollingElement.scrollHeight > innerHeight, stageBottom: Math.round(st.bottom), peaksBottom: Math.round(pk.bottom), statusTop: Math.round(ft.top) }; }""")
    print('layout at 1100x650:', lay)
    shot(pg, 'c_drt_small')
    pg.select_option('#drt-x', 'tau'); pg.wait_for_timeout(300)
    print('tau axis (spectrum x, 1/(2 pi f), residuals share x, label):', pg.evaluate("(() => { const p = Y.drtTab.plots(), z = p[2].series[0]; return [z.x[0], 1 / (2 * Math.PI * z.fq[0]), p[0].series[0].x[0] === z.x[0], p[2].o.xlabel]; })()"))
    print('zoom on g moves the others:', pg.evaluate("(() => { const p = Y.drtTab.plots(); p[1].o.onView({ x0: -4, x1: -2 }); return [p[0].view.x0, p[2].view.x0]; })()"))
    pg.dblclick('#drt-g canvas'); pg.wait_for_timeout(200); shot(pg, 'c_drt_tau')
    pg.select_option('#drt-x', 'f'); pg.wait_for_timeout(200)
    pg.set_viewport_size({'width': 1440, 'height': 900})
    pg.fill('#cmdline', 'zhit'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(400); print('zhit:', status(pg))
    # history: restore from the Log, then undo the restore
    pg.evaluate("Y.cmd.runCommand('select>>^demo_01$')"); pg.wait_for_timeout(100)
    v0 = pg.evaluate('[Y.state.first().zr[3], Y.state.first().zi[3]]')
    for c in ['rndz>>4', 'negate_zi']:
        pg.fill('#cmdline', c); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(150)
    v1 = pg.evaluate('[Y.state.first().zr[3], Y.state.first().zi[3]]')
    pg.click('[data-tab="log"]'); pg.wait_for_timeout(200)
    nbtn = pg.evaluate("document.querySelectorAll('#log-list [data-restore]').length")
    pg.click("#log-list li:has-text('Added noise') [data-restore]"); pg.wait_for_timeout(300)
    v2 = pg.evaluate('[Y.state.first().zr[3], Y.state.first().zi[3]]')
    pg.fill('#cmdline', 'undo'); pg.press('#cmdline', 'Enter'); pg.wait_for_timeout(200)
    v3 = pg.evaluate('[Y.state.first().zr[3], Y.state.first().zi[3]]')
    print('history: %d restore buttons; before noise %s, after noise+negate %s, restored %s, undo of the restore %s' % (nbtn, v0, v1, v2, v3))
    print('  restored == before noise:', v2 == v0, '| undo brings back the later state:', v3 == v1)
    print('  info:', pg.inner_text('#history-info')[:120])
    shot(pg, 'd_log')
    # contributions follow the legend; normalization by electrode area and back
    pg.evaluate("Y.cmd.runCommand('select>>^demo_02$')"); pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(100)
    pg.keyboard.press('F9'); pg.wait_for_timeout(1500)
    contrib(pg, True); pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(300)
    cvis = pg.evaluate("""() => { const n = Y.plots._plots.nyq, id = Y.state.first().id, parts = () => n.visibleSeries().filter(s => String(s.group).startsWith('part')).length;
        const a = parts(); n.hidden.add('part1'); n.draw(); const b = parts(); n.hidden.delete('part1'); n.hidden.add(id); n.draw(); const c = parts(); n.hidden.clear(); n.draw(); return [a, b, c]; }""")
    print('contribution curves visible: all %d, part 1 hidden %d, dataset hidden %d' % tuple(cvis))
    contrib(pg, False); pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(200)
    get = "(() => { const d = Y.state.first(); return [d.zr[5], d.p.R2, d.p.Q1, d.p.Q1_n, d.stats && d.stats.chi2red]; })()"
    before = pg.evaluate(get)
    pg.click('[data-menu="data"]'); pg.click('text=Normalize: area'); pg.wait_for_timeout(200)
    shown = pg.evaluate("[...document.querySelectorAll('dialog [data-when]')].filter(e => !e.hidden).length")
    pg.select_option('[data-key="type"]', 'area'); pg.fill('[data-key="A"]', '0.5'); pg.wait_for_timeout(100)
    shown2 = pg.evaluate("[...document.querySelectorAll('dialog [data-when]')].filter(e => !e.hidden).length")
    pg.click('dialog button:has-text("Apply")'); pg.wait_for_timeout(400)
    after = pg.evaluate(get)
    print('normalize dialog: fields shown %d for None, %d for area | %s' % (shown, shown2, status(pg)))
    print('  ratios after/before (Zr, R2, Q1, n, chi2red):', [round(a / b, 6) for a, b in zip(after, before)])
    print('  units:', pg.evaluate("[Y.plots._plots.nyq.o.xlabel, document.querySelector('#param-list .prow[data-name=\"R2\"] .pu').textContent, document.querySelector('#param-list .prow[data-name=\"Q1\"] .pu').textContent, document.querySelector('.ds.on .du') && document.querySelector('.ds.on .du').textContent, Y.state.first().stats ? 'stats kept' : 'stats lost']"))
    rt = pg.evaluate("(() => { const t = Y.writers.dataText([Y.state.first()], { sep: 'tab' }, () => null); const r = Y.readers.headerTable(t, 'x.txt')[0]; return [t.split('\\n')[1], r.norm]; })()")
    print('  saved and read back:', rt)
    shot(pg, 'e_norm')
    pg.click('[data-menu="data"]'); pg.click('text=Normalize: area'); pg.wait_for_timeout(200)
    pg.select_option('[data-key="type"]', 'none'); pg.click('dialog button:has-text("Apply")'); pg.wait_for_timeout(300)
    back = pg.evaluate(get)
    print('  back to none, relative change from the start:', max(abs(a / b - 1) for a, b in zip(back, before)), '|', status(pg))
    pg.click('#theme-toggle'); pg.wait_for_timeout(200); print('theme after the switch:', pg.evaluate('document.documentElement.dataset.theme'))
    pg.click('[data-tab="drt"]'); pg.wait_for_timeout(500); shot(pg, 'b_drt_dark')
    pg.click('#theme-toggle'); pg.wait_for_timeout(100)
    pg.emulate_media(color_scheme='dark'); pg.click('[data-tab="model"]'); pg.wait_for_timeout(300); shot(pg, '9_dark_model')
    pg.evaluate("Y.app.showTab('nyq')"); pg.evaluate('Y.state.selectAll()'); pg.wait_for_timeout(300); shot(pg, '9_dark_nyq')
    # ---- menus and buttons follow the situation; square Nyquist plot
    pg.emulate_media(color_scheme='light')
    pg.evaluate("Y.cmd.runCommand('select>>^demo_03$')"); pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(200)
    unm = lambda: [m for m in menu_state('data') if m[0].startswith('Unmask')][0]
    a = unm(); pg.evaluate("Y.state.first().mask[2] = 1; Y.bus.emit('data')"); pg.wait_for_timeout(50); b2 = unm()
    pg.evaluate("Y.state.first().mask[2] = 0; Y.bus.emit('data')")
    print('Unmask without masked points: %s (%s); with one: %s' % ('greyed' if a[1] else 'available', a[2], 'greyed' if b2[1] else 'available'))
    lab = lambda: pg.evaluate("document.querySelector('[data-plot-action=unlabel]').disabled")
    l0 = lab(); pg.evaluate("Y.cmd.runCommand('label>>1k')"); pg.wait_for_timeout(100); l1 = lab()
    print('Clear labels disabled without labels: %s, with one: %s' % (l0, l1))
    pg.evaluate("Y.app.showTab('model')")
    mk = [m for m in menu_state('data') if m[0].startswith('Mask')][0]
    pg.evaluate("void Y.cmd.inView(false)"); pg.wait_for_timeout(150)
    print('mask with the Model tab open: %s (%s) | command: %s' % ('greyed' if mk[1] else 'available', mk[2], status(pg)))
    pg.evaluate("Y.app.showTab('nyq')"); pg.evaluate("Y.app.showSide('fit')"); pg.click('[data-fitmode="global"]'); pg.wait_for_timeout(100)
    print('global fit, one dataset: Fit disabled %s |' % pg.evaluate("document.getElementById('btn-fit').disabled"), pg.inner_text('#fit-target').split('\n')[-1])
    pg.click('[data-fitmode="single"]')
    pg.evaluate("window._f = Object.assign({}, Y.state.first().fit); Y.state.names().forEach(n => Y.state.setFit(n, false))"); pg.wait_for_timeout(100)
    print('no parameter ticked: Fit disabled %s |' % pg.evaluate("document.getElementById('btn-fit').disabled"), pg.get_attribute('#btn-fit', 'title'))
    pg.evaluate("Object.keys(window._f).forEach(n => Y.state.setFit(n, window._f[n]))"); pg.wait_for_timeout(100)
    print('  ticked again: Fit disabled', pg.evaluate("document.getElementById('btn-fit').disabled"))
    # square Nyquist plot: square canvas and frame, centred in the pane; the saved PNG and the report image are square too
    pg.check('#nyq-square'); pg.wait_for_timeout(300)
    sq = pg.evaluate("""() => { const p = Y.plots._plots.nyq, b = p.box, h = document.getElementById('nyq-host');
        return { canvas: [p.W, p.H], frame: [Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0)], host: [h.clientWidth, h.clientHeight], left: p.canvas.offsetLeft,
                 settingsBox: document.getElementById('set_nyqSquare').checked, spans: [+(p.view.x1 - p.view.x0).toPrecision(4), +(p.view.y1 - p.view.y0).toPrecision(4)] }; }""")
    print('square Nyquist:', sq)
    tip = pg.evaluate("""() => { const p = Y.plots._plots.nyq, s = p.visibleSeries().find(x => x.hover && x.x.length), q = p._xy(s, 0); p._hover(q);
        return [Math.round(parseFloat(p.tip.style.left) - p.canvas.offsetLeft - q[0]), Math.round(parseFloat(p.tip.style.top) - q[1])]; }""")
    print('  tooltip offset from its point (12, or -(width + 12) near the edge):', tip)
    from PIL import Image as PILImage
    with pg.expect_download() as dl:
        pg.click('#ptools [data-plot-action="png"]')
    print('  PNG size:', PILImage.open(dl.value.path()).size)
    rep = pg.evaluate("""() => new Promise(r => { const im = new Image(); im.onload = () => r([im.naturalWidth, im.naturalHeight]); im.src = Y.plots.imagesFor(Y.state.first(), 560, 360).nyq; })""")
    print('  report Nyquist image:', rep)
    shot(pg, 'f_square')
    pg.uncheck('#nyq-square'); pg.wait_for_timeout(200)
    print('  unticked: canvas and margin', pg.evaluate("[Y.plots._plots.nyq.W, Y.plots._plots.nyq.H, Y.plots._plots.nyq.canvas.style.marginLeft || '0']"))
    # ---- the look comes from style.css only: "system" resolved, dataset colours and font sizes follow the variables,
    #      the side panel resets to --side-w, reports stay light while the page is dark
    pg.emulate_media(color_scheme='dark'); pg.evaluate("Y.state.setSetting('theme', 'system')"); pg.wait_for_timeout(150)
    t_dark = pg.evaluate("document.documentElement.dataset.theme")
    pg.emulate_media(color_scheme='light'); pg.wait_for_timeout(150)
    print('theme "system" resolved to: %s in dark, %s in light' % (t_dark, pg.evaluate("document.documentElement.dataset.theme")))
    pg.evaluate("Y.app.showTab('nyq')"); pg.wait_for_timeout(150)
    css = pg.evaluate("""() => { const r = document.documentElement, d = Y.state.S.datasets[0], n = (d.id - 1) % Y.theme.get().series.length + 1, P = Y.plots._plots.nyq;
        const m0 = P.box.x0; r.style.setProperty('--series-' + n, '#ff00ff'); r.style.setProperty('--plot-font-size', '16px'); Y.theme.refresh(); Y.bus.emit('theme'); P.resize();
        const out = { color: Y.plots.color(d), swatch: getComputedStyle(document.querySelector('.ds[data-id="' + d.id + '"] .sw')).backgroundColor, margin: [m0, P.box.x0] };
        r.style.removeProperty('--series-' + n); r.style.removeProperty('--plot-font-size'); Y.theme.refresh(); Y.bus.emit('theme'); P.resize();
        out.back = P.box.x0; return out; }""")
    print('variables decide: dataset colour %s, list square %s, left margin %s -> %s' % (css['color'], css['swatch'], css['margin'], css['back']))
    pg.dblclick('#side-grip'); pg.wait_for_timeout(100)
    print('side panel after double-click: %d px' % pg.evaluate("Math.round(document.querySelector('.side').getBoundingClientRect().width)"))
    pg.evaluate("Y.state.setSetting('theme', 'dark')"); pg.wait_for_timeout(150)
    rl = pg.evaluate("""() => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0); res([Array.from(x.getImageData(3, 3, 1, 1).data), /color:#1f2933/.test(Y.report.build([Y.state.first()]))]); };
        im.src = Y.plots.imagesFor(Y.state.first(), 560, 360).nyq; })""")
    print('dark page: report image corner %s, report text in light ink: %s' % (rl[0], rl[1]))
    pg.evaluate("Y.state.setSetting('theme', 'light')")
    # Stop ends a batch of long fits at once (40 000-point spectra, Nelder-Mead: tens of seconds each); the datasets not
    # fitted keep their values, and the workers that were replaced fit normally afterwards
    pg.evaluate("""(() => { const prog = Y.circuit.compile(Y.circuit.parse('R(RQ)(RQ)')), f = Y.dataops.logspace(1e6, 1e-2, 40000), raws = [];
      for (let i = 0; i < 4; i++) { const z = Y.circuit.impedance(prog, f, Float64Array.from([50, 1.2e4, 2e-10, 0.93, 4e4, 6e-7, 0.82]));
        raws.push({ name: 'long_' + i, f: f, zr: z.re, zi: z.im }); }
      Y.state.addDatasets(raws, { selectAll: true }); Y.state.setSetting('method', 'NM'); Y.state.setSetting('maxIter', 65535);
      Y.state.store('fitmode', 'single'); })()""")
    before = pg.evaluate("Y.state.selected().map(d => d.p.R2)")
    pg.evaluate("Y.app.showSide('fit')"); pg.click('[data-fitmode=\"single\"]'); pg.click('#btn-fit'); pg.wait_for_timeout(1500)
    t0 = time.time(); pg.click('#btn-stop'); pg.wait_for_function('!Y.state.S.busy', timeout=120000); dt = time.time() - t0
    after = pg.evaluate("Y.state.selected().map(d => d.p.R2)")
    print('stop: busy cleared %.2f s after Stop | values of the datasets not fitted unchanged: %s |' % (dt, before == after), status(pg)[:90])
    pg.evaluate("Y.state.setSetting('method', 'TRDL'); Y.state.setSetting('maxIter', 2500); Y.cmd.runCommand('select>>^demo_0[0-2]$')")
    pg.click('#btn-fit'); pg.wait_for_function('!Y.state.S.busy', timeout=60000)
    print('  next fit after the stop:', status(pg)[:70])
    # a project saved with its Log, written in UTF-16 and opened through the file reader: the Log comes back with its
    # dates, without Restore buttons, and the Log kept for the project continues from it
    n_log = pg.evaluate('Y.ui.logEntries().length')
    proj = pg.evaluate('Y.writers.projectJSON(Y.state.S, Y.ui.logEntries())')
    pg.evaluate("""(t) => { const b = new Uint8Array(2 + 2 * t.length); b[0] = 0xff; b[1] = 0xfe;
        for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); b[2 + 2 * i] = c & 255; b[3 + 2 * i] = c >> 8; }
        window.__proj = new File([b], 'utf16_project.json'); Y.cmd.readFiles([window.__proj], 'project'); }""", proj)
    pg.wait_for_selector('#dlg[open] .primary'); pg.click('#dlg .primary'); pg.wait_for_timeout(300)
    lg = pg.evaluate("[document.querySelectorAll('#log-list li.saved').length, document.querySelector('#log-list li.saved-head span').textContent, "
                     "document.querySelectorAll('#log-list li.saved [data-restore]').length, Y.ui.logEntries().length]")
    print('project with its Log, UTF-16 file: %d lines shown (%s), restore buttons among them %d, Log kept %d lines (%d saved + the opening)' % (lg[0], lg[1], lg[2], lg[3], n_log))
    b.close()
    # worker failures, simulated: an error event on the worker that received the last job (a wrapper records it)
    b = p.chromium.launch(); pg = b.new_page()
    pg.add_init_script("""(() => { const W = window.Worker; window.__lastWorker = null;
      window.Worker = function (u, o) { const w = new W(u, o), pm = w.postMessage.bind(w);
        w.postMessage = function (m) { window.__lastWorker = w; return pm(m); }; return w; };
      window.Worker.prototype = W.prototype; })();""")
    pg.goto('file://' + os.path.join(ROOT, 'index.html')); pg.wait_for_timeout(500)
    pg.evaluate("""(() => { Y.state.setModel(Y.circuit.parse('R(RQ)(RQ)')); const prog = Y.state.S.model.prog, f = Y.dataops.logspace(1e6, 1e-2, 200), raws = [];
      for (let i = 0; i < 2; i++) { const z = Y.circuit.impedance(prog, f, Float64Array.from([50, 1.2e4, 2e-10, 0.93, 4e4, 6e-7, 0.82]));
        raws.push({ name: 'w_' + i, f: f, zr: z.re, zi: z.im }); }
      Y.state.addDatasets(raws, { selectAll: true }); })()""")
    crash = "window.__lastWorker.dispatchEvent(new ErrorEvent('error', { message: 'simulated crash' }));"
    pg.evaluate('Y.cmd.fitSelected(); ' + crash); pg.wait_for_function('!Y.state.S.busy', timeout=60000); once = status(pg)
    pg.evaluate('Y.cmd.fitSelected(); ' + crash + crash); pg.wait_for_function('!Y.state.S.busy', timeout=60000); twice = status(pg)
    pg.evaluate('Y.cmd.globalFit(); ' + crash); pg.wait_for_function('!Y.state.S.busy', timeout=60000); gonce = status(pg)
    pg.evaluate('Y.cmd.globalFit(); ' + crash + crash); pg.wait_for_function('!Y.state.S.busy', timeout=60000); gtwice = status(pg)
    print('worker stops once during a fit: %s\n  twice on the same fit: %s' % (once[:70], twice[:110]))
    print('  global fit, once: %s\n  global fit, twice: %s\n  fits still in workers: %s' % (gonce[:60], gtwice[:120], pg.evaluate('Y.pool.usingWorkers()')))
    b.close()
print('\n'.join(logs) if logs else 'no console errors or warnings')
from PIL import Image
def montage(names, out):
    ims = [Image.open(os.path.join(OUT, n + '.png')) for n in names]
    w, h = ims[0].size; s = 0.5
    M = Image.new('RGB', (int(w * s) * 2, int(h * s) * ((len(ims) + 1) // 2)), 'white')
    for i, im in enumerate(ims):
        M.paste(im.resize((int(w * s), int(h * s)), Image.LANCZOS), ((i % 2) * int(w * s), (i // 2) * int(h * s)))
    M.save(os.path.join(OUT, out))
montage(['1_single_nyq', '2_all_nyq', '3_zr', '3_d3'], 'montage_a.png')
montage(['4_model', '5_params', '7_menu', '9_dark_nyq'], 'montage_b.png')
montage(['0_custom_dialog', '0_zmfli_nyq', '0_hp_zr', '0_mfli_nyq'], 'montage_c.png')
montage(['a_contrib_nyq', 'a_contrib_zi', 'a_contrib_model', 'a_sigma_zr'], 'montage_d.png')
montage(['b_drt', 'b_search', 'b_drt_dark', 'c_drt_tau'], 'montage_e.png')
montage(['6_masked', '5_params', 'd_log', 'a_sigma_zr'], 'montage_f.png')
montage(['e_norm', 'c_drt_tau'], 'montage_g.png')
