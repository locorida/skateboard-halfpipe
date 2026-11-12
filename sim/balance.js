// Balance-Simulation: Bots spielen halfpipe.js mit verschiedenen Spielweisen, eine Session (60 s) pro Lauf.
// Prüft, dass sich Pumpen lohnt (und nur richtig getimtes), dass Nichtstun und Dauer-Hocke keine Punkte bringen
// und dass Tricks den Unterschied machen. Exit-Code 1, wenn eine Erwartung nicht erfüllt ist.
// Aufruf: node sim/balance.js [Läufe]
const fs = require('fs');
const path = require('path');

// reproduzierbarer Zufall für die Timing-Fehler der Bots
let seed = 12345;
Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
const canvas = { getContext: () => ctx, addEventListener: noop, focus: noop };
global.window = global;
global.devicePixelRatio = 1;
global.addEventListener = noop;
global.document = { getElementById: (id) => (id === 'halfpipe' ? canvas : null), addEventListener: noop };
global.requestAnimationFrame = noop;
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'halfpipe.js'), 'utf8'));

const H = window.Halfpipe.T, K = H.keys;
const RUNS = +process.argv[2] || 30;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// style: none | hold | pump. noise: Streuung (s) beim Loslassen, ×4 als Fehler beim Drehen. tricks: Drehungen versuchen
function play(style, noise, tricks) {
    H.start();
    const dt = 1 / 120;
    let t = 0, firstVert = null, maxH = 0, releaseAt = null, spinTarget = 0, spinStop = 0, lastSign = 0;
    const bottom = []; // Tempo unten nach jeder Abfahrt (m/s)
    while (H.state.mode !== 'over' && t < 70) {
        const s = H.state;
        K.left = K.right = false;
        if (s.mode === 'ground') {
            const sn = Math.sin(H.TH[H.segAt(s.s)]), vert = s.v * sn;
            if (style === 'hold') K.down = true;
            else if (style === 'pump') {
                if (vert < -0.3 && Math.abs(sn) > 0.3) { K.down = true; releaseAt = null; }
                else if (K.down) {
                    if (releaseAt === null) releaseAt = t + Math.max(0, 0.05 + gauss() * noise);
                    if (t >= releaseAt) { K.down = false; releaseAt = null; }
                }
            } else K.down = false;
            if (Math.abs(sn) < 0.01 && Math.sign(s.v) !== lastSign) { bottom.push(Math.abs(s.v)); lastSign = Math.sign(s.v); }
            spinTarget = 0;
        } else {
            K.down = false;
            if (s.mode === 'vert') {
                if (firstVert === null) firstVert = t;
                maxH = Math.max(maxH, s.h);
                if (tricks) {
                    if (!spinTarget) {
                        spinTarget = Math.max(0, Math.floor((s.T - 0.2) * 7 / Math.PI)) * Math.PI;
                        spinStop = spinTarget + gauss() * noise * 4;
                    }
                    if (spinTarget && s.yaw - s.yaw0 < spinStop) K.left = true;
                }
            }
        }
        H.update(dt);
        t += dt;
    }
    const s = H.state;
    return { firstVert, maxH, score: s.score, bails: s.bails, lastBottom: bottom.length ? bottom[bottom.length - 1] : 0 };
}

function median(list) { const a = list.filter((x) => x !== null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; }
const PLAYERS = [
    ['idle', 'none', 0, false], ['holds down', 'hold', 0, false], ['pumps, exact', 'pump', 0, false],
    ['pumps, ±0.2 s', 'pump', 0.2, false], ['tricks, good', 'pump', 0.08, true], ['tricks, sloppy', 'pump', 0.15, true],
];
const res = {};
for (const [name, style, noise, tricks] of PLAYERS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(play(style, noise, tricks));
    const r = res[name] = {
        firstVert: median(runs.map((x) => x.firstVert)), maxH: median(runs.map((x) => x.maxH)),
        score: median(runs.map((x) => x.score)), bails: median(runs.map((x) => x.bails)),
        endKmh: median(runs.map((x) => x.lastBottom)) * 3.6,
    };
    console.log(name.padEnd(15), `first air over coping ${r.firstVert === null ? '   –' : r.firstVert.toFixed(1).padStart(4) + ' s'}`,
        `| max height ${r.maxH.toFixed(1)} m | score ${String(r.score).padStart(5)} | bails ${r.bails} | speed at the end ${r.endKmh.toFixed(0)} km/h`);
}

// Streetpark: pumpen an den Quarters, auf der Fläche anschieben, optional vor dem Rail ollien und die Balance halten.
// grind: Ollie aufs Rail versuchen. balance: gegensteuern (mit Reaktionszeit). noise: Streuung beim Absprung (m)
function playStreet(grind, balance, noise) {
    window.Halfpipe.setPark('street');
    H.start();
    const dt = 1 / 120, G = 9.81, POP = 3.6;
    let t = 0, firstVert = null, releaseAt = null, crouch = false, aimOff = 0, react = 0, lean = null;
    while (H.state.mode !== 'over' && t < 70) {
        const s = H.state;
        K.left = K.right = K.down = false;
        if (s.mode === 'ground') {
            const sn = Math.sin(H.TH[H.segAt(s.s)]), vert = s.v * sn, dir = Math.sign(s.v);
            if (vert < -0.3 && Math.abs(sn) > 0.3) { crouch = true; releaseAt = null; }
            else if (crouch) {
                if (releaseAt === null) releaseAt = t + 0.05;
                if (t >= releaseAt) { crouch = false; releaseAt = null; }
            }
            K.down = crouch;
            if (Math.abs(sn) < 0.12 && Math.abs(s.v) < 6) { if (dir > 0) K.right = true; else if (dir < 0) K.left = true; }
            if (grind && Math.abs(sn) < 0.01 && Math.abs(s.v) > 2) {
                const x = H.posAt(s.s).x;
                for (const r of H.rails) { // Absprung so, dass man 0.6 m hinter dem Railanfang aufsetzt
                    const tf = (POP + Math.sqrt(POP * POP - 2 * G * r.h)) / G, xl = x + s.v * tf + aimOff;
                    const entry = dir > 0 ? r.x0 + 0.6 : r.x1 - 0.6;
                    if ((dir > 0 ? x < r.x0 : x > r.x1) && Math.abs(xl - entry) < 0.08) { window.Halfpipe.press('jump', true); aimOff = gauss() * noise; break; }
                }
            }
        } else {
            crouch = false;
            if (s.mode === 'grind' && balance) {
                if (t >= react) { // Reaktionszeit: eine Entscheidung gilt 0.12 s
                    lean = s.bal > 0.08 ? 'left' : s.bal < -0.08 ? 'right' : null;
                    react = t + 0.12;
                }
                if (lean) K[lean] = true;
            }
            if (s.mode === 'vert' && firstVert === null) firstVert = t;
        }
        H.update(dt);
        t += dt;
    }
    const s = H.state;
    window.Halfpipe.setPark('pipe');
    return { firstVert, score: s.score, bails: s.bails, grinds: s.grinds };
}
const STREET = [['street, airs only', false, false, 0], ['street, grinds', true, true, 0.3], ['street, no balance', true, false, 0.3]];
for (const [name, grind, balance, noise] of STREET) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(playStreet(grind, balance, noise));
    const r = res[name] = {
        firstVert: median(runs.map((x) => x.firstVert)), score: median(runs.map((x) => x.score)),
        bails: median(runs.map((x) => x.bails)), grinds: median(runs.map((x) => x.grinds)),
    };
    console.log(name.padEnd(19), `first air over coping ${r.firstVert === null ? '   –' : r.firstVert.toFixed(1).padStart(4) + ' s'}`,
        `| grinds ${String(r.grinds).padStart(2)} | score ${String(r.score).padStart(5)} | bails ${r.bails}`);
}

const checks = [
    ['idle scores nothing and slows down', res.idle.score === 0 && res.idle.endKmh < 20],
    ['holding down all the time is worse than idle', res['holds down'].score === 0 && res['holds down'].endKmh < res.idle.endKmh],
    ['exact pumping reaches the coping within 8 s', res['pumps, exact'].firstVert !== null && res['pumps, exact'].firstVert <= 8],
    ['exact pumping gets airs of 2 m or more', res['pumps, exact'].maxH >= 2],
    ['sloppy pumping still works', res['pumps, ±0.2 s'].firstVert !== null && res['pumps, ±0.2 s'].firstVert <= 15],
    ['good tricks score far more than plain airs', res['tricks, good'].score > 4 * res['pumps, exact'].score],
    ['sloppy tricks score less and crash more', res['tricks, sloppy'].score < res['tricks, good'].score && res['tricks, sloppy'].bails > res['tricks, good'].bails],
    ['street: pumping reaches the coping within 10 s', res['street, airs only'].firstVert !== null && res['street, airs only'].firstVert <= 10],
    ['street: ollie onto the rail works (4+ grinds)', res['street, grinds'].grinds >= 4],
    ['street: grinding scores far more than airs only', res['street, grinds'].score > 2 * res['street, airs only'].score],
    ['street: without balancing you fall off', res['street, no balance'].bails > res['street, grinds'].bails && res['street, no balance'].score < res['street, grinds'].score],
];
let ok = true;
for (const [label, pass] of checks) { console.log(pass ? '  ok  ' : '  FAIL', label); ok = ok && pass; }
process.exit(ok ? 0 : 1);
