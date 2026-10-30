/*
 * smart-scheduler 0.82 test suite (fake clock, fake Node-RED runtime, in-memory MQTT).
 * Run with: npm test
 */
'use strict';
const assert = require('assert');
const sinon = require('sinon');
const H = require('./helpers/fake-red');
const lib = require('../lib/scheduler.js');

// Thursday 29 Oct 2026, 20:00 local time (built from local fields, so the suite runs in any TZ).
const START = new Date(2026, 9, 29, 20, 0, 0).getTime();
let clock, RED, nodes;

const ev = (id, ruleIdx, s_dow, s_mod, e_dow, e_mod) => ({ id, ruleIdx, s_dow, s_mod, e_dow, e_mod,
    start: new Date(2026, 9, 25 + s_dow, 0, s_mod).toISOString(), end: new Date(2026, 9, 25 + e_dow, 0, e_mod).toISOString() });
const RULES = [{ ruleIdx: 0, setName: 'Eco', spTemp: '19', setColor: '#53cf95' }, { ruleIdx: 1, setName: 'Confort', spTemp: '21', setColor: '#ff9900' }];

function load() {
    delete require.cache[require.resolve('../smart-scheduler.js')];
    RED = H.createRED();
    require('../smart-scheduler.js')(RED);
}
function sched(extra = {}, events) {
    const schedules = [{ idx: 1, name: 'Week', events: events || [ev(1, 0, 4, 0, 4, 1439)] }];
    const n = RED.create('smart-scheduler', Object.assign({
        id: extra.id || 's1', name: 'Parent scheduler', rules: RULES, schedules: JSON.stringify(schedules),
        activScheduleId: '1', defaultSp: '5', overrideDuration: '120', cycleDuration: 1, allowOverride: true,
        triggerMode: 'triggerMode.statechange.startup', debugInfo: 'none',
    }, extra));
    nodes.push(n);
    clock.tick(1500);
    return n;
}
const sent = (n) => n.sent.map(s => s.msg.payload);
const lastSent = (n) => { const a = sent(n); return a[a.length - 1]; };
const min = (m) => clock.tick(m * 60000);

describe('smart-scheduler 0.82', function () {
    this.timeout(60000);      // long simulated periods (12 h, 25 h) on a fake clock; slow disks need more than 2 s
    describe('Schedule matching (lib/scheduler.js)', function () {
        const at = (d, h, m = 0) => new Date(2026, 9, 25 + d, h, m);   // 25 Oct 2026 is a Sunday (d=0)
        const m = (events, d, h, mi) => lib.matchSchedule({ events }, at(d, h, mi)).ruleIdx;

        it('S-01 matches a same-day event, inclusive of its end minute', function () {
            const E = [ev(1, 1, 1, 8 * 60, 1, 18 * 60)];
            assert.strictEqual(m(E, 1, 7, 59), -1);
            assert.strictEqual(m(E, 1, 8, 0), 1);
            assert.strictEqual(m(E, 1, 18, 0), 1);
            assert.strictEqual(m(E, 1, 18, 1), -1);
        });

        it('S-02 matches an event crossing midnight after midnight (failed in 0.81)', function () {
            const E = [ev(1, 1, 2, 22 * 60, 3, 6 * 60)];         // Tue 22:00 -> Wed 06:00
            assert.strictEqual(m(E, 2, 23, 0), 1);
            assert.strictEqual(m(E, 3, 3, 0), 1);
            assert.strictEqual(m(E, 3, 6, 30), -1);
        });

        it('S-03 matches a multi-day event on the days in between (failed in 0.81)', function () {
            const E = [ev(1, 1, 1, 8 * 60, 5, 18 * 60)];          // Mon 08:00 -> Fri 18:00
            assert.strictEqual(m(E, 3, 12, 0), 1);
            assert.strictEqual(m(E, 6, 12, 0), -1);
        });

        it('S-04 matches an event wrapping Saturday -> Sunday', function () {
            const E = [ev(1, 1, 6, 22 * 60, 0, 2 * 60)];          // Sat 22:00 -> Sun 02:00
            assert.strictEqual(m(E, 6, 23, 0), 1);
            assert.strictEqual(m(E, 0, 1, 0), 1);
            assert.strictEqual(m(E, 0, 3, 0), -1);
        });

        it('S-05 accepts Sunday stored as 7 and an event ending at midnight', function () {
            assert.strictEqual(m([ev(1, 1, 7, 10 * 60, 7, 12 * 60)], 0, 11, 0), 1);
            assert.strictEqual(m([ev(1, 1, 5, 20 * 60, 6, 0)], 5, 23, 59), 1);
        });

        it('S-06 when events overlap, the last one wins (as in 0.81)', function () {
            const E = [ev(1, 0, 1, 8 * 60, 1, 18 * 60), ev(2, 1, 1, 12 * 60, 1, 14 * 60)];
            assert.strictEqual(m(E, 1, 13, 0), 1);
        });

        it('S-07 ignores malformed events and missing configuration', function () {
            assert.strictEqual(lib.matchSchedule(undefined).ruleIdx, -1);
            assert.strictEqual(lib.matchSchedule({}).ruleIdx, -1);
            assert.strictEqual(m([null, { s_dow: 'x' }, ev(1, 1, 1, 0, 1, 600)], 1, 5, 0), 1);
        });
    });

    describe('Scheduler node', function () {
        beforeEach(function () {
            clock = sinon.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
            H.resetBroker();
            nodes = [];
            load();
        });
        afterEach(async function () {
            for (const n of nodes) await RED.close(n);
            clock.restore();
        });

        it('S-08 sends the scheduled setpoint at startup', function () {
            const n = sched();
            assert.strictEqual(lastSent(n).command, 'set');
            assert.strictEqual(lastSent(n).setpoint, 19);
            assert.strictEqual(lastSent(n).setname, 'Eco');
        });

        it('S-09 re-sends the current setpoint every 15 min even when unchanged', function () {
            const n = sched();
            const n0 = sent(n).length;
            min(61);
            assert.strictEqual(sent(n).length - n0, 4);
        });

        it('S-10 resend can be disabled (only on change, as in 0.81)', function () {
            const n = sched({ resendInterval: '0' });
            const n0 = sent(n).length;
            min(61);
            assert.strictEqual(sent(n).length - n0, 0);
        });

        it('S-11 "off" sends the default setpoint (0.81 sent nothing)', function () {
            const n = sched();
            RED.input(n, { payload: { command: 'off' } });
            assert.strictEqual(lastSent(n).setpoint, 5);
            assert.strictEqual(lastSent(n).setname, 'off');
            RED.input(n, { payload: { command: 'auto' } });
            assert.strictEqual(lastSent(n).setpoint, 19);
        });

        it('S-12 manual mode sends a real payload without MQTT (0.81 sent {})', function () {
            const n = sched();
            RED.input(n, { payload: { command: 'override', setpoint: 22 } });
            assert.strictEqual(lastSent(n).command, 'set');
            assert.strictEqual(lastSent(n).setpoint, 22);
            assert.strictEqual(lastSent(n).setname, 'override');
        });

        it('S-13 an override expires after its duration and the schedule comes back', function () {
            const n = sched({ overrideDuration: '30' });
            RED.input(n, { payload: { command: 'override', setpoint: 22 } });
            min(29);
            assert.strictEqual(lastSent(n).setpoint, 22);
            min(3);
            assert.strictEqual(lastSent(n).setpoint, 19);
        });

        it('S-14 overrides and setpoints are capped at max setpoint', function () {
            const n = sched({ maxSp: '23' });
            RED.input(n, { payload: { command: 'override', setpoint: 30 } });
            assert.strictEqual(lastSent(n).setpoint, 23);
        });

        it('S-15 loop guard: the same override right after it expired is ignored, a new value is accepted', function () {
            const n = sched({ overrideDuration: '30' });
            RED.input(n, { payload: { command: 'override', setpoint: 23 } });
            min(32);
            assert.strictEqual(lastSent(n).setpoint, 19);
            RED.input(n, { payload: { command: 'override', setpoint: 23 } });     // stuck TRV repeating itself
            assert.strictEqual(lastSent(n).setpoint, 19);
            assert.strictEqual(n.executionMode, 'auto');
            RED.input(n, { payload: { command: 'override', setpoint: 21 } });     // a person
            assert.strictEqual(lastSent(n).setpoint, 21);
        });

        it('S-16 a rule change is sent even when the setpoint is the same', function () {
            const RULES2 = [{ ruleIdx: 0, setName: 'Eco', spTemp: '19' }, { ruleIdx: 1, setName: 'Night', spTemp: '19' }];
            const n = sched({ rules: RULES2, resendInterval: '0' }, [ev(1, 0, 4, 0, 4, 20 * 60 + 30), ev(2, 1, 4, 20 * 60 + 31, 4, 1439)]);
            const n0 = sent(n).length;
            min(35);
            const after = sent(n).slice(n0);
            assert.ok(after.some(p => p.setname === 'Night'), 'rule change sent');
        });

        it('S-17 falls back to the default setpoint outside any event', function () {
            const n = sched({}, [ev(1, 1, 1, 8 * 60, 1, 18 * 60)]);
            assert.strictEqual(lastSent(n).setpoint, 5);
            assert.strictEqual(lastSent(n).setname, 'default rule');
        });

        it('S-18 invalid input does not crash', function () {
            const n = sched();
            [{}, { payload: null }, { payload: { command: 42 } }, { payload: { command: 'boom' } },
             { payload: { command: 'override' } }, { payload: { command: 'override', setpoint: 'x' } },
             { payload: { command: 'schedule' } }, { payload: { command: 'schedule', name: 'nope' } }]
                .forEach(m => assert.doesNotThrow(() => RED.input(n, m)));
            assert.strictEqual(lastSent(n).setpoint, 19);
        });

        it('S-19 bad schedules JSON is reported, not thrown at deploy', function () {
            assert.doesNotThrow(() => sched({ id: 'bad', schedules: '{not json' }));
            const n = nodes[nodes.length - 1];
            assert.ok(n.logs.error.some(e => /schedules JSON/.test(e)));
        });

        it('S-20 an exception during the timer evaluation is caught', function () {
            const n = sched();
            n.rules = { find() { throw new Error('boom'); } };
            assert.doesNotThrow(() => min(3));
            assert.ok(n.logs.error.some(e => /evaluate\(\) failed: boom/.test(e)));
        });

        it('S-21 saved mode survives a restart, but an editor change wins', async function () {
            let n = sched();
            RED.input(n, { payload: { command: 'off' } });
            await RED.close(n); nodes = [];
            n = sched();                                           // same config: stays off
            assert.strictEqual(n.executionMode, 'off');
            await RED.close(n); nodes = [];
            n = sched({ overrideDuration: '60' });                 // editor changed: config wins
            assert.strictEqual(n.executionMode, 'auto');
        });

        it('S-23 overrides are ignored when "Override" is not ticked', function () {
            const n = sched({ allowOverride: false });
            RED.input(n, { payload: { command: 'override', setpoint: 22 } });
            assert.strictEqual(n.executionMode, 'auto');
            assert.strictEqual(lastSent(n).setpoint, 19);
        });

        it('S-22 uses the MQTT root path from the settings node', function () {
            RED.addConfig('ss', { mqttHost: 'broker', mqttPort: 1883, mqttRootPath: 'ha' });
            const n = sched({ mqttSettings: 'ss' });
            assert.strictEqual(n.mqttPrefix, 'ha');
            assert.ok(H.broker.log.some(m => m.topic.startsWith('ha/select/')));
        });
    });
});
