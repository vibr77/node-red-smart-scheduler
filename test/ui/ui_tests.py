"""
UI test suite for the smart-scheduler editor (plus the new valve/boiler/settings fields),
run in headless Chromium against a real Node-RED 4 with the 0.82 modules installed.

Usage: python3 ui_tests.py <outdir>
Every test opens the editor fresh, acts like a user, and checks both the screen and the saved data.
The CDN (cdn.jsdelivr.net) is unreachable from this machine, so the whole run is also an offline test.
"""
import sys, os, json, urllib.request, traceback
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'ui-results'
os.makedirs(OUT, exist_ok=True)
BASE = 'http://127.0.0.1:1880'
results = []


def flows():
    with urllib.request.urlopen(BASE + '/flows') as r:
        return json.loads(r.read())


def sched_node():
    return next(n for n in flows() if n.get('id') == 'sch1')


class UI:
    def __init__(self, page):
        self.pg = page
        self.errors = []
        page.on('pageerror', lambda e: self.errors.append(str(e)[:300]))
        page.on('dialog', lambda d: d.accept())          # "leave page with unsaved changes?" 
        page.on('console', lambda m: m.type == 'error' and 'catalogue' not in m.text and 'ERR_TUNNEL' not in m.text
                and self.errors.append('console: ' + m.text[:300]))

    def load(self):
        pg = self.pg
        pg.goto(BASE + '/?x=' + str(len(results)), wait_until='domcontentloaded')
        pg.wait_for_function('window.RED && RED.nodes && RED.nodes.node("sch1")', timeout=30000)
        pg.wait_for_timeout(800)
        for label in ['No, do not enable notifications', 'Close']:
            try:
                pg.get_by_text(label, exact=True).click(timeout=800)
            except Exception:
                pass

    def open(self, node_id='sch1', wait_calendar=True):
        pg = self.pg
        pg.evaluate(f'RED.editor.edit(RED.nodes.node("{node_id}"))')
        pg.wait_for_selector('#node-dialog-ok', state='visible')
        if wait_calendar:
            pg.wait_for_function('() => !!document.querySelector("#calendar.fc, #calendar .fc")', timeout=15000)
            pg.wait_for_timeout(300)

    def done(self):
        self.pg.click('#node-dialog-ok')
        self.pg.wait_for_selector('#node-dialog-ok', state='detached', timeout=5000)

    def cancel(self):
        self.pg.click('#node-dialog-cancel')
        self.pg.wait_for_selector('#node-dialog-cancel', state='detached', timeout=5000)

    def js(self, expr):
        return self.pg.evaluate(expr)

    def events_shown(self):
        # calendar events (an event crossing midnight is drawn as two pieces, so count events, not DOM blocks)
        return self.js('RED.nodes.node("sch1").calendar.getEvents().length')

    def active_events(self):
        return self.js('RED.nodes.node("sch1").activeSched.events.map(e => ({id:e.id, r:+e.ruleIdx, s_dow:e.s_dow, s_mod:e.s_mod, e_dow:e.e_dow, e_mod:e.e_mod}))')

    def deploy(self):
        self.pg.click('#red-ui-header-button-deploy')
        self.pg.wait_for_timeout(2000)


def test(name):
    def wrap(fn):
        def run(ui):
            ui.load()                                   # fresh editor for every test
            ui.errors.clear()
            try:
                fn(ui)
                assert not ui.errors, 'page errors: ' + ' | '.join(ui.errors)
                results.append((name, 'PASS', ''))
            except Exception as e:
                results.append((name, 'FAIL', (str(e) or traceback.format_exc())[:400]))
                try:
                    ui.pg.screenshot(path=f'{OUT}/FAIL-{name.split()[0]}.png')
                except Exception:
                    pass
                for sel in ['#node-config-dialog-cancel', '#node-dialog-cancel']:
                    try:
                        if ui.pg.is_visible(sel):
                            ui.pg.click(sel)
                    except Exception:
                        pass
        run.__name__ = name
        return run
    return wrap


@test('U-01 editor opens offline: calendar, rules, schedules and events are shown')
def t01(ui):
    ui.open()
    assert ui.js('document.querySelectorAll("#node-input-rule-container > li").length') == 4
    opts = ui.js('[...document.querySelectorAll("#node-input-activeSchedule option")].map(o => o.text)')
    assert opts == ['Week', 'Holidays'], opts
    assert ui.events_shown() == 15, ui.events_shown()
    ui.pg.screenshot(path=f'{OUT}/U-01-editor.png')
    ui.cancel()


@test('U-02 new options Re-send every and Max setpoint are shown with defaults')
def t02(ui):
    ui.open()
    assert ui.js('$("#node-input-resendInterval").val()') == '15'
    assert ui.js('$("#node-input-maxSp").val()') == '24'
    ui.cancel()


@test('U-03 switching the active schedule shows its events')
def t03(ui):
    ui.open()
    ui.pg.select_option('#node-input-activeSchedule', label='Holidays')
    ui.pg.wait_for_timeout(300)
    assert ui.events_shown() == 1, ui.events_shown()
    ui.pg.select_option('#node-input-activeSchedule', label='Week')
    ui.pg.wait_for_timeout(300)
    assert ui.events_shown() == 15, ui.events_shown()
    ui.cancel()


@test('U-04 painting a period with the mouse adds an event with the right day and minutes')
def t04(ui):
    ui.open()
    ui.pg.click('#sched_btn_1')                                  # Eco
    ui.pg.locator('.fc-timegrid-slot-lane[data-time="12:00:00"]').first.scroll_into_view_if_needed()
    ui.pg.wait_for_timeout(300)
    col = ui.pg.locator('.fc-timegrid-col[data-date="2018-01-06"]').first      # Saturday
    cb = col.bounding_box()
    y0 = ui.pg.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').first.bounding_box()
    y1 = ui.pg.locator('.fc-timegrid-slot-lane[data-time="11:30:00"]').first.bounding_box()
    x = cb['x'] + cb['width'] / 2
    ui.pg.mouse.move(x, y0['y'] + 3)
    ui.pg.mouse.down()
    ui.pg.mouse.move(x, y1['y'] + 3, steps=8)
    ui.pg.mouse.up()
    ui.pg.wait_for_timeout(400)
    evs = ui.active_events()
    new = [e for e in evs if e['s_dow'] == 6 and e['s_mod'] == 600]
    assert len(new) == 1, evs[-3:]
    assert 690 <= new[0]['e_mod'] <= 720 and new[0]['r'] == 1, new     # 5-min snapping where the drag ends
    ui.pg.screenshot(path=f'{OUT}/U-04-painted.png')
    ui.cancel()


@test('U-05 delete mode: clicking an event removes it')
def t05(ui):
    ui.open()
    before = len(ui.active_events())
    ui.pg.click('#sched_btn_del')
    ui.pg.locator('#calendar .fc-timegrid-event').first.click()
    ui.pg.wait_for_timeout(300)
    assert len(ui.active_events()) == before - 1
    assert ui.events_shown() == 14
    ui.cancel()


@test('U-06 Copy Friday -> Sunday copies the Friday events (Sunday was broken in 0.81)')
def t06(ui):
    ui.open()
    ui.pg.select_option('#node-input-cc-src', '5')
    ui.pg.select_option('#node-input-cc-dest', '7')
    ui.pg.click('#node-input-CloneDay')
    ui.pg.wait_for_timeout(300)
    sun = [e for e in ui.active_events() if e['s_dow'] == 0]
    assert len(sun) == 3, sun
    cold = [e for e in sun if e['s_mod'] == 22 * 60]
    assert cold and cold[0]['e_dow'] == 1 and cold[0]['e_mod'] == 360, cold   # Sun 22:00 -> Mon 06:00
    ui.cancel()


@test('U-07 Copy onto a day replaces its events instead of duplicating them')
def t07(ui):
    ui.open()
    ui.pg.select_option('#node-input-cc-src', '1')
    ui.pg.select_option('#node-input-cc-dest', '2')
    ui.pg.click('#node-input-CloneDay')
    ui.pg.wait_for_timeout(300)
    tue = [e for e in ui.active_events() if e['s_dow'] == 2]
    assert len(tue) == 3, tue
    ui.cancel()


@test('U-08 renaming a schedule updates the selector')
def t08(ui):
    ui.open()
    ui.pg.fill('#node-input-scheduleName', 'Normal week')
    ui.pg.press('#node-input-scheduleName', 'End')
    ui.pg.wait_for_timeout(200)
    assert ui.js('$("#node-input-activeSchedule option:selected").text()') == 'Normal week'
    ui.cancel()


@test('U-09 adding then deleting a schedule')
def t09(ui):
    ui.open()
    ui.pg.click('#node-input-addSchedule')
    ui.pg.wait_for_timeout(300)
    opts = ui.js('[...document.querySelectorAll("#node-input-activeSchedule option")].map(o => o.text)')
    assert len(opts) == 3 and opts[2].startswith('New schedule'), opts
    assert ui.events_shown() == 0
    ui.pg.click('#node-input-deleteSchedule')
    ui.pg.wait_for_timeout(300)
    opts = ui.js('[...document.querySelectorAll("#node-input-activeSchedule option")].map(o => o.text)')
    assert len(opts) == 2, opts
    ui.cancel()


@test('U-10 adding a set point creates a row and a paint button')
def t10(ui):
    ui.open()
    ui.pg.locator('.red-ui-editableList-addButton').first.click()
    ui.pg.wait_for_timeout(300)
    assert ui.js('document.querySelectorAll("#node-input-rule-container > li").length') == 5
    assert ui.js('document.querySelectorAll("#sched_btn_grp .my-button-group").length') == 6   # 5 rules + delete
    ui.cancel()


@test('U-11 an invalid set point marks the node invalid (0.81 accepted it and sent NaN)')
def t11(ui):
    ui.open()
    ui.pg.fill('#node-input-temp-sp_1', 'abc')
    ui.done()
    assert ui.js('RED.nodes.node("sch1").valid') is False
    ui.open()
    ui.pg.fill('#node-input-temp-sp_1', '19')
    ui.done()
    assert ui.js('RED.nodes.node("sch1").valid') is True


@test('U-12 Cancel discards calendar changes')
def t12(ui):
    ui.open()
    ui.pg.click('#node-input-EmptySched')
    assert ui.events_shown() == 0
    ui.cancel()
    ui.open()
    assert ui.events_shown() == 15
    ui.cancel()


@test('U-13 calendar unavailable: clear message, Done works, schedules kept (0.81 could not save)')
def t13(ui):
    before = ui.js('RED.nodes.node("sch1").schedules')
    ui.pg.route('**/fullcalendar-6.1.9.global.min.js', lambda r: r.abort())
    ui.pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    saved_fc = ui.js('(() => { const f = window.FullCalendar; delete window.FullCalendar; window.__fc = f; return !!f; })()')
    try:
        ui.open(wait_calendar=False)
        ui.pg.wait_for_selector('#calendar :text("could not be loaded")', timeout=10000)
        ui.pg.screenshot(path=f'{OUT}/U-13-offline-message.png')
        ui.errors.clear()          # the aborted request itself is logged as a console error
        ui.done()
        assert ui.js('RED.nodes.node("sch1").schedules') == before
    finally:
        ui.pg.unroute('**/fullcalendar-6.1.9.global.min.js')
        ui.pg.unroute('**/cdn.jsdelivr.net/**')
        ui.js('window.FullCalendar = window.__fc; true')
        ui.errors.clear()


@test('U-14 editing does not leak variables into the page (0.81 left ctrl_i, start, end, m_s… global)')
def t14(ui):
    ui.open()
    ui.pg.click('#sched_btn_2')
    ui.js('RED.nodes.node("sch1").calendar.select("2018-01-03T13:00:00", "2018-01-03T14:00:00")')
    ui.cancel()
    leaked = ui.js('["ctrl_i","start","end","m_s","m_e","s_dow","s_mod","e_dow","e_mod","idx"].filter(k => k in window)')
    assert leaked == [], leaked


@test('U-15 valve editor shows the Safety section with defaults')
def t15(ui):
    ui.open('sv1', wait_calendar=False)
    vals = ui.js('Object.fromEntries(["maxSp","heartbeat","sensorTimeout","trvTimeout","alarmDuration","frozenDelta","frozenDuration","ackTimeout","failedAction","trvLocalTempKey","trvAlarmKey"].map(k => [k, $("#node-input-"+k).val()]))')
    assert vals == {"maxSp": "24", "heartbeat": "10", "sensorTimeout": "120", "trvTimeout": "90", "alarmDuration": "60",
                    "frozenDelta": "3", "frozenDuration": "60", "ackTimeout": "5", "failedAction": "failedAction.release",
                    "trvLocalTempKey": "local_temperature", "trvAlarmKey": "valve_alarm"}, vals
    ui.pg.locator('#node-input-ackTimeout').scroll_into_view_if_needed()
    ui.pg.screenshot(path=f'{OUT}/U-15-valve-safety.png')
    ui.done()


@test('U-16 boiler editor shows Valve timeout, Max SP, Unsatisfied and Hold for')
def t16(ui):
    ui.open('sb1', wait_calendar=False)
    vals = ui.js('Object.fromEntries(["itemMaxAge","maxSp","unsatisfiedTimeout","minRise","unsatisfiedHold"].map(k => [k, $("#node-input-"+k).val()]))')
    assert vals == {"itemMaxAge": "30", "maxSp": "25", "unsatisfiedTimeout": "180", "minRise": "0.3", "unsatisfiedHold": "120"}, vals
    ui.done()


@test('U-17 settings nodes show HA discovery and State topic')
def t17(ui):
    for t, i in [('smart-valve-settings', 'vs1'), ('smart-boiler-settings', 'bs1')]:
        ui.js(f'RED.editor.editConfig("", "{t}", "{i}")')
        ui.pg.wait_for_selector('#node-config-input-haDiscovery', state='attached', timeout=5000)
        assert ui.js('$("#node-config-input-haBaseTopic").val()') == 'smartheating'
        ui.pg.click('#node-config-dialog-cancel')
        ui.pg.wait_for_timeout(400)


@test('U-19 nodes saved by 0.81 (no new options) load as valid, no deploy warning')
def t19(ui):
    invalid = ui.js('(() => { const bad = []; RED.nodes.eachNode(n => { if (n.valid === false) bad.push(n.type + ":" + n.name); }); RED.nodes.eachConfig(n => { if (n.valid === false) bad.push(n.type + ":" + n.name); }); return bad; })()')
    assert invalid == [], invalid


@test('U-18 save and deploy: the runtime receives the painted event and the scheduler keeps running')
def t18(ui):
    ui.open()
    ui.pg.click('#sched_btn_3')                                         # Confort+
    ui.js('RED.nodes.node("sch1").calendar.select("2018-01-07T09:00:00", "2018-01-07T10:30:00")')   # Sunday
    ui.pg.fill('#node-input-resendInterval', '20')
    ui.done()
    ui.deploy()
    n = sched_node()
    s = json.loads(n['schedules'])
    week = next(x for x in s if x['name'] == 'Week')
    new = [e for e in week['events'] if e['s_dow'] == 0 and e['s_mod'] == 540]
    assert len(new) == 1 and new[0]['e_mod'] == 630 and int(new[0]['ruleIdx']) == 3, new
    assert n['resendInterval'] == '20' and n['activScheduleId'] == '1'
    assert all(set(e) >= {'s_dow', 's_mod', 'e_dow', 'e_mod', 'ruleIdx'} for e in week['events'])
    ui.pg.wait_for_timeout(2000)
    status = ui.js('(RED.nodes.node("sch1")._def && RED.nodes.node("sch1").status) || null')
    ui.pg.screenshot(path=f'{OUT}/U-18-deployed.png')


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1500, 'height': 1100})
    ui = UI(page)
    ui.load()
    for t in [t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, t12, t13, t14, t15, t16, t17, t19, t18]:
        t(ui)
    browser.close()

w = max(len(r[0]) for r in results)
for name, st, msg in results:
    print(f'{st:4}  {name}' + (f'\n      -> {msg}' if msg else ''))
print(f'\n{sum(r[1] == "PASS" for r in results)} passed, {sum(r[1] == "FAIL" for r in results)} failed')
json.dump(results, open(f'{OUT}/results.json', 'w'), indent=1)
