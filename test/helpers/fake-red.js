/*
 * Test harness for the vib smart-heating Node-RED modules.
 *
 *  - A fake Node-RED runtime (RED.nodes.createNode, send, status, context, input/close events).
 *  - An in-memory MQTT broker that replaces the `mqtt` package.
 *  - Simulated Zigbee2MQTT devices: a room sensor and an Aqara-like TRV that can be healthy,
 *    stuck (z2m keeps re-publishing cached values, like TRV_CHLOE in October 2026) or silent.
 *
 * Use with sinon fake timers: every delay in the modules and the simulators runs on the fake clock.
 */
'use strict';
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------------------------
// In-memory MQTT broker
// ---------------------------------------------------------------------------------------------
class Broker {
    constructor() { this.subs = []; this.log = []; this.retained = {}; this.clients = []; }
    publish(topic, payload, opts) {
        const str = Buffer.isBuffer(payload) ? payload.toString() : String(payload);
        this.log.push({ t: Date.now(), topic, payload: str, retain: !!(opts && opts.retain) });
        if (opts && opts.retain) this.retained[topic] = str;
        this.subs.filter(s => s.topic === topic && s.client.connected).forEach(s => {
            setTimeout(() => s.client._emit('message', topic, Buffer.from(str)), 0);
        });
    }
    // Messages published on a topic (parsed JSON when possible), optionally since a timestamp.
    on(topic, since) {
        return this.log.filter(m => m.topic === topic && (since === undefined || m.t >= since)).map(m => {
            try { return JSON.parse(m.payload); } catch (e) { return m.payload; }
        });
    }
    last(topic) { const a = this.on(topic); return a[a.length - 1]; }
    clear() { this.log = []; }
}

let broker = new Broker();

function connect(url, opts) {
    const handlers = {};
    const client = {
        connected: false, opts,
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return client; },
        _emit(ev, ...a) { (handlers[ev] || []).forEach(f => f(...a)); },
        subscribe(topics, cb) {
            [].concat(topics).forEach(t => broker.subs.push({ client, topic: t }));
            if (cb) cb(null);
        },
        publish(topic, payload, o, cb) { broker.publish(topic, payload, o); if (cb) cb(null); },
        end() {
            client.connected = false;
            broker.subs = broker.subs.filter(s => s.client !== client);
        },
    };
    broker.clients.push(client);
    setTimeout(() => { client.connected = true; client._emit('connect'); }, 0);
    return client;
}
const fakeMqtt = { connect };

// Route require('mqtt') to the fake broker for every module loaded after this file.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'mqtt') return fakeMqtt;
    return origLoad.apply(this, arguments);
};

// ---------------------------------------------------------------------------------------------
// Fake Node-RED runtime
// ---------------------------------------------------------------------------------------------
function createRED() {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-test-'));
    const types = {};
    const nodes = {};
    const RED = {
        settings: { userDir },
        _: (k) => k,
        auth: { needsPermission: () => (req, res, next) => next && next() },
        httpAdmin: { post() {}, get() {} },
        nodes: {
            registerType(name, ctor) { types[name] = ctor; },
            getNode(id) { return nodes[id]; },
            getCredentials() { return {}; },
            createNode(node, n) {
                const handlers = {};
                const ctx = {};
                node.id = n.id; node.type = n.type; node.z = n.z;
                node.sent = []; node.statuses = []; node.logs = { log: [], warn: [], error: [] };
                node.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
                node._handlers = handlers;
                node.send = (msg) => {
                    const arr = Array.isArray(msg) ? msg : [msg];
                    arr.forEach(m => { if (m) node.sent.push({ t: Date.now(), msg: JSON.parse(JSON.stringify(m)) }); });
                    (node._wires || []).forEach(fn => arr.forEach(m => { if (m) fn(JSON.parse(JSON.stringify(m))); }));
                };
                node.status = (s) => { node.statuses.push(s); node._status = s; };
                node.log = (m) => node.logs.log.push(String(m));
                node.warn = (m) => node.logs.warn.push(String(m));
                node.error = (m) => node.logs.error.push(String(m));
                node.context = () => ({ get: (k) => ctx[k], set: (k, v) => { ctx[k] = v; } });
                nodes[n.id] = node;
            },
        },
    };
    RED.types = types;
    RED.all = nodes;
    // Register a config node (settings) directly.
    RED.addConfig = (id, obj) => { nodes[id] = Object.assign({ id }, obj); return nodes[id]; };
    // Create a node of a registered type.
    RED.create = (type, cfg) => {
        const N = types[type];
        if (!N) throw new Error('type not registered: ' + type);
        const obj = Object.create(N.prototype);
        N.call(obj, Object.assign({ type }, cfg));
        return obj;
    };
    RED.input = (node, msg) => (node._handlers.input || []).forEach(f => f(msg, node.send, () => {}));
    RED.close = (node) => new Promise(res => {
        const hs = node._handlers.close || [];
        if (!hs.length) return res();
        let left = hs.length; hs.forEach(f => f(() => { if (--left === 0) res(); }));
    });
    // Wire node A's output into node B's input.
    RED.wire = (a, b) => { a._wires = (a._wires || []).concat([(m) => RED.input(b, m)]); };
    return RED;
}

// ---------------------------------------------------------------------------------------------
// Simulated Zigbee2MQTT devices
// ---------------------------------------------------------------------------------------------
class Sensor {
    // An Aqara temperature sensor: reports every `every` minutes (and on demand).
    constructor(topic, temp, every = 20, jitter = 0) { this.topic = topic; this.temp = temp; this.every = every; this.alive = true; this._t = null; this.jitter = jitter; this._n = 0; }
    start() { this.report(); this._t = setInterval(() => this.report(), this.every * 60000); return this; }
    report() {
        // jitter: real sensors wobble by a few hundredths of a degree between reports.
        const t = this.jitter ? Math.round((this.temp + ((this._n++ % 2) ? this.jitter : 0)) * 100) / 100 : this.temp;
        if (this.alive) broker.publish(this.topic, JSON.stringify({ temperature: t, battery: 90, linkquality: 120 }));
    }
    set(t) { this.temp = t; this.report(); }
    stop() { clearInterval(this._t); }
}

class Trv {
    // An Aqara E1-like TRV behind Zigbee2MQTT.
    //  mode 'healthy': applies setpoints, mirrors the external temperature, reports often.
    //  mode 'stuck'  : radio alive but thermostat hung; z2m re-publishes the cached frozen state hourly.
    //  mode 'dead'   : publishes nothing.
    constructor(name, opts = {}) {
        this.name = name;
        this.topic = 'zigbee2mqtt/' + name;
        this.state = Object.assign({
            occupied_heating_setpoint: 20, local_temperature: 20, valve_alarm: false,
            system_mode: 'heat', sensor: 'external', battery: 100, linkquality: 120,
        }, opts.state || {});
        this.mode = opts.mode || 'healthy';
        this.every = opts.every || 5;            // healthy report period (min)
        this.checkin = opts.checkin || 52;        // stuck check-in period (min)
        this.sets = [];
        this.ignoreExternal = !!opts.ignoreExternal;   // TRV that stopped using the external temperature
        this.step = opts.step || 0;                     // e.g. 0.5: the TRV rounds setpoints to its step
        this._sub = { connected: true, _emit: (ev, topic, buf) => this._onSet(topic, buf.toString()) };
        ['occupied_heating_setpoint', 'external_temperature_input', 'sensor', 'system_mode'].forEach(k =>
            broker.subs.push({ client: this._sub, topic: `${this.topic}/set/${k}` }));
    }
    start() {
        this.report();
        this._t = setInterval(() => { if (this.mode === 'healthy') this.report(); }, this.every * 60000);
        this._c = setInterval(() => { if (this.mode === 'stuck') this.report(); }, this.checkin * 60000);
        return this;
    }
    stop() { clearInterval(this._t); clearInterval(this._c); }
    report() { if (this.mode !== 'dead') broker.publish(this.topic, JSON.stringify(Object.assign({ last_seen: new Date().toISOString() }, this.state))); }
    // Somebody turns the knob on the device.
    knob(sp) { this.state.occupied_heating_setpoint = sp; if (this.mode === 'healthy') this.report(); }
    _onSet(topic, payload) {
        const key = topic.split('/').pop();
        this.sets.push({ t: Date.now(), key, payload });
        if (this.mode !== 'healthy') return;      // a stuck or dead TRV ignores commands
        let v = payload; try { v = JSON.parse(payload); } catch (e) { /* string */ }
        if (key === 'occupied_heating_setpoint') this.state.occupied_heating_setpoint = this.step ? Math.round(parseFloat(v) / this.step) * this.step : parseFloat(v);
        if (key === 'external_temperature_input' && !this.ignoreExternal) this.state.local_temperature = parseFloat(v);
        if (key === 'sensor') this.state.sensor = v;
        if (key === 'system_mode') this.state.system_mode = v;
        setTimeout(() => this.report(), 2000);     // z2m publishes the new state after the write
    }
}

function valveConfig(id, name, extra = {}) {
    // Mirrors the real SV_* nodes in the HEATING flow (Zigbee2MQTT topics, Aqara keys).
    return Object.assign({
        id, name, groupId: '1', mqttSettings: 'vs',
        temperatureSensorStateTopic: `zigbee2mqtt/TH_${name}`, temperatureSensorKey: 'temperature',
        valveSetpointStateTopic: `zigbee2mqtt/TRV_${name}`,
        valveSetpointSetTopic: `zigbee2mqtt/TRV_${name}/set/occupied_heating_setpoint`,
        valveSetpointKey: 'occupied_heating_setpoint',
        valveTemperatureSetTopic: `zigbee2mqtt/TRV_${name}/set/external_temperature_input`, valveTemperatureKey: 'notuse',
        valveModeStateTopic: `zigbee2mqtt/TRV_${name}`, valveModeSetTopic: `zigbee2mqtt/TRV_${name}/set/system_mode`, valveModeKey: 'system_mode',
        valveTemperatureSensorTypeSetTopic: `zigbee2mqtt/TRV_${name}/set/sensor`, valveTemperatureSensorTypePayload: 'external',
        OverrideDuration: '60', msgStormMaxMsg: '20', cycleDuration: '1', offSp: '5',
        spUpdateMode: 'spUpdateMode.statechange', allowOverride: false, debugInfo: 'none',
    }, extra);
}

function boilerConfig(id, extra = {}) {
    // Mirrors RSL_BOILER in the HEATING flow.
    return Object.assign({
        id, name: 'RSL_BOILER', mqttSettings: 'bs',
        boilerCurrentTemperatureSetTopic: 'homeassistant/OT_BOILER_64/currentTemperature/state', boilerCurrentTemperatureKey: 'value',
        boilerSpSetTopic: 'homeassistant/OT_BOILER_64/setpointTemperature/set', boilerSpKey: '',
        boilerLeadingDeviceSetTopic: 'homeassistant/OT_BOILER_64/leadingDevice/state',
        boilerLeadingDeviceIdSetTopic: 'homeassistant/OT_BOILER_64/leadingDeviceId/state', boilerLeadingDeviceKey: 'value',
        boilerSwCentralHeatingSetTopic: 'homeassistant/OT_BOILER_64/swCentralHeating/set', boilerSwCentralHeatingKey: '',
        boilerEntityID: 'OT_BOILER_64', mqttUpdates: true, debugInfo: 'none', boilerSecurity: true,
        triggerMode: 'triggerMode.everyCycle', cycleDuration: '60', outputUpdates: true,
        defaultSp: '7', defaultTemp: '10', maxDurationSinceLastInput: '15',
    }, extra);
}

module.exports = {
    get broker() { return broker; },
    resetBroker() { broker = new Broker(); return broker; },
    createRED, Sensor, Trv, valveConfig, boilerConfig,
    BOILER: {
        sp: 'homeassistant/OT_BOILER_64/setpointTemperature/set',
        temp: 'homeassistant/OT_BOILER_64/currentTemperature/state',
        lead: 'homeassistant/OT_BOILER_64/leadingDevice/state',
        ch: 'homeassistant/OT_BOILER_64/swCentralHeating/set',
    },
};
