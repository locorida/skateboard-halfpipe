// Skateboard Halfpipe: kleines 3D-Spiel auf Canvas, ohne Bibliotheken (eigene Perspektiv-Projektion).
// Skateboard oder Stunt-Scooter in einer Halfpipe mit Funbox in der Mitte. 60 Sekunden, so viele Tricks wie möglich.
// Physik in Metern: Der Fahrer bewegt sich entlang des Profils (Bogenlänge s), in der Luft ballistisch (Ollie, z. B.
// über die Funbox) oder senkrecht über der Kante (Coping). Über die Funbox rollt man, springen nur mit Ollie.
// Schwung holt man durch Pumpen: beim Herunterfahren ↓ halten (Hocke), unten im Bogen loslassen (strecken).
// Wer ↓ dauerhaft hält, wird bergauf langsamer.
// Erwartet ein <canvas id="halfpipe"> (optional mit data-texts) und ein Element #halfpipe-status (aria-live).
// window.Halfpipe.setVehicle('skate'|'scooter'|'bmx'), setPark('pipe'|'street'|'bmx'), setFreeRide(bool),
// window.Halfpipe.press(k, down) für Touch-Knöpfe. Im BMX-Park (Schrottauto, Reifen) geht nur das BMX.
// window.Halfpipe.T: Zugriff auf Zustand und Physik für die Simulation (sim/balance.js).
(function () {
    'use strict';

    const cv = document.getElementById('halfpipe');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const status = document.getElementById('halfpipe-status');
    const CW = 960, CH = 540, FOCAL = 640;

    // Texte: deutsch als Vorgabe, überschreibbar per data-texts (JSON) am Canvas, siehe index.html
    const TXT = Object.assign({
        title: 'Halfpipe-Session', start: 'Leertaste oder Tippen: Drop-in', sub: '60 Sekunden, so viele Tricks wie möglich',
        over: 'Session vorbei', points: 'Punkte', time: 'Zeit', combo: 'Kombo', record: 'Rekord', newRecord: 'Neuer Rekord!',
        again: 'Leertaste oder Tippen: nochmal', bail: 'Sturz!', bailSub: 'gerade landen', pump: 'Pump!',
        hint: '↓ halten beim Runterfahren, unten loslassen = Schwung', air: 'Air', grab: 'Grab', tuck: 'Tuck',
        flip: 'Kickflip', whip: 'Tailwhip', double: 'Doppel-',
        titleStreet: 'Street-Session', fifty: '50-50', fiveO: '5-0', boardslide: 'Boardslide', grind: 'Grind', feeble: 'Feeble',
        hintStreet: 'Leertaste vor dem Rail = Ollie drauf, dann mit ← → die Balance halten', woof: 'Wuff!',
        titleBmx: 'BMX-Session', hintBmx: 'Leertaste = Bunnyhop: über die Reifen, und an der Kante der Rampe übers Auto',
        barspin: 'Barspin', tabletop: 'Tabletop', peg: 'Double Peg', carJump: 'Autosprung', tireHop: 'Reifen-Hop',
        free: 'Free Ride', subFree: 'Ohne Zeit, einfach fahren',
    }, JSON.parse((cv.dataset && cv.dataset.texts) || '{}'));

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

    // ---------- Parks (Meter) ----------
    // R: Radius der Wände, W: halbe Breite der Fläche dazwischen, KA/KB/KH: Funbox (Plateau bis KA, Rampe bis KB, Höhe KH),
    // ZW: halbe Tiefe, DECK: Plattform hinter der Kante, rails: Rails und Ledges hinter der Fahrlinie (z < 0) zum Grinden
    const PARKS = {
        pipe: { R: 3.2, W: 6, KA: 1.0, KB: 2.6, KH: 0.8, ZW: 3.2, DECK: 2.2, rails: [], best: 'halfpipe-best',
            // nur ein paar Kritzeleien mit dem Edding auf dem Holz
            graffiti: [
                { t: 'ollie!', tag: '#1a1a1a', x0: -10.6, x1: -9.3, y0: 1.45, y1: 2.15, rot: -0.12 },
                { t: 'HARZ 26', tag: '#f4f1e8', x0: -0.9, x1: 0.9, y0: 0.12, y1: 0.66, rot: 0.04 },
                { t: 'zeke', tag: '#b8261c', x0: 8.9, x1: 10.6, y0: 0.25, y1: 0.95, rot: 0.1 },
            ],
            wall: [222, 196, 150], flat: [200, 202, 198], box: [176, 182, 190], side: '#a8875a', sideLine: '#7a5a33', deck: [222, 196, 150] },
        street: { R: 2.6, W: 9, KA: 0.7, KB: 1.9, KH: 0.55, ZW: 3.6, DECK: 1.8, best: 'halfpipe-best-street',
            rails: [{ x0: -7, x1: -2.8, h: 0.5, z: -1, type: 'rail' }, { x0: 2.8, x1: 7, h: 0.42, z: -1.1, type: 'ledge' }],
            // Graffiti auf den Seitenwänden vorne (Quarters und Funbox); crowd: Skater vor der Rückwand, die zuschauen
            graffiti: [
                { t: 'SHRED', c: 'pink', x0: -12.9, x1: -10.7, y0: 0.08, y1: 1.0, rot: -0.06 },
                { t: 'HARZ', c: 'cyan', x0: 10.7, x1: 12.9, y0: 0.08, y1: 1.0, rot: 0.05 },
                { t: 'GNAR', c: 'green', x0: -0.8, x1: 0.8, y0: 0.02, y1: 0.55, rot: -0.03 },
            ],
            wall: [190, 192, 194], flat: [178, 180, 182], box: [160, 164, 170], side: '#8d9196', sideLine: '#62676c', deck: [168, 172, 176] },
        // BMX-Park: kleine Halfpipe, in der Mitte Absprung und Landerampe (gap) mit einem Schrottauto dazwischen,
        // links und rechts Reifenstapel zum Drüberhüpfen. Nur mit dem BMX (only).
        bmx: { R: 2.4, W: 14, KA: 2.4, KB: 3.8, KH: 0.65, ZW: 2.4, DECK: 1.8, rails: [], gap: true, only: 'bmx', best: 'halfpipe-best-bmx', graffiti: [],
            obst: [
                { type: 'tires', x0: -9.38, x1: -8.62, h: 0.48, pts: 90, name: 'tireHop' },
                { type: 'car', x0: -1.8, x1: 1.8, h: 1.25, pts: 260, name: 'carJump' },
                { type: 'tires', x0: 8.62, x1: 9.38, h: 0.48, pts: 90, name: 'tireHop' },
            ],
            wall: [214, 186, 140], flat: [128, 132, 134], box: [200, 168, 118], side: '#8b6a42', sideLine: '#5e4526', deck: [206, 178, 132] },
    };
    const G = 9.81;
    const KBACK = 0.35; // Rückseite der Absprungrampe im BMX-Park (steil, 0.35 m)
    let park = PARKS.pipe, parkId = 'pipe', R, W, XMAX, KA, KB, KH, ZW, DECK, RAILS, OBST = [], LIPS = [];
    // Fahrgefühl
    const VMAX = 11;              // m/s (ca. 40 km/h): Air über der Kante dann knapp 3 m
    const FRIC_A = 0.12, FRIC_B = 0.003; // Rollreibung + Luftwiderstand (m/s²)
    const PUMP = 1.3;             // Schub beim Loslassen mit voller Ladung und gutem Timing (m/s)
    const PUMP_LATE = 0.3;        // s nach dem Ende der Abfahrt, bis der Schub auf 30 % abgefallen ist
    const CHARGE_RATE = 2.2;      // Ladung pro Sekunde in der Hocke beim Herunterfahren (× Steilheit)
    const CROUCH_DRAG = 0.9;      // Hocke bergauf: so viel langsamer (m/s² × Steilheit)
    const SPIN_RATE = 7;          // rad/s (ca. 400°/s)
    const SETTLE_RATE = 3.5;      // rad/s (ca. 200°/s): so schnell dreht sich der Fahrer nach dem Loslassen von selbst gerade
    const FLIP_TIME = 0.42;       // s für einen Kickflip/Tailwhip
    const SESSION = 60;

    function groundY(x) {
        const ax = Math.abs(x);
        if (ax >= XMAX) return R;
        if (ax > W) { const d = ax - W; return R - Math.sqrt(Math.max(0, R * R - d * d)); }
        if (park.gap) { const kf = KA - KBACK; if (ax <= kf) return 0; if (ax <= KA) return KH * (ax - kf) / KBACK; }
        else if (ax <= KA) return KH;
        if (ax <= KB) return KH * (KB - ax) / (KB - KA);
        return 0;
    }
    // Profil als Polylinie; die Arrays bleiben dieselben Objekte (die Simulation hält TH fest)
    const P = [], SS = [], TH = [], LEN = [], QUADS = [];
    let NS = 0, S_END = 0;
    function buildPark(id) {
        parkId = PARKS[id] ? id : 'pipe'; park = PARKS[parkId];
        ({ R, W, KA, KB, KH, ZW, DECK } = park); XMAX = W + R; RAILS = park.rails; OBST = park.obst || [];
        P.length = SS.length = TH.length = LEN.length = QUADS.length = 0;
        for (let a = 90; a > 0; a -= 3) { const r = a * Math.PI / 180; P.push({ x: -W - R * Math.sin(r), y: R - R * Math.cos(r) }); }
        const KEYX = park.gap ? [-W, -KB, -KA, -(KA - KBACK), KA - KBACK, KA, KB, W] : [-W, -KB, -KA, KA, KB, W];
        for (let i = 0; i < KEYX.length - 1; i++) {
            const x0 = KEYX[i], x1 = KEYX[i + 1], n = Math.max(1, Math.round((x1 - x0) / 0.5));
            for (let j = 0; j < n; j++) { const x = x0 + (x1 - x0) * j / n; P.push({ x, y: groundY(x) }); }
        }
        for (let a = 0; a <= 90; a += 3) { const r = a * Math.PI / 180; P.push({ x: W + R * Math.sin(r), y: R - R * Math.cos(r) }); }
        NS = P.length - 1; SS.push(0);
        for (let i = 0; i < NS; i++) {
            const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y, l = Math.hypot(dx, dy);
            LEN.push(l); TH.push(Math.atan2(dy, dx)); SS.push(SS[i] + l);
        }
        S_END = SS[NS];
        // Kanten der Absprungrampen: links geht es nach rechts in die Luft, rechts nach links
        LIPS = park.gap ? [{ s: sFromX(-KA).s, dir: 1 }, { s: sFromX(KA).s, dir: -1 }] : [];
        buildQuads();
    }
    function segAt(s) { let lo = 0, hi = NS - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (SS[m] <= s) lo = m; else hi = m - 1; } return lo; }
    function posAt(s) { const i = segAt(s), t = clamp((s - SS[i]) / LEN[i], 0, 1); return { x: P[i].x + (P[i + 1].x - P[i].x) * t, y: P[i].y + (P[i + 1].y - P[i].y) * t }; }
    function sFromX(x) {
        let lo = 0, hi = NS - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m].x <= x) lo = m; else hi = m - 1; }
        const dx = P[lo + 1].x - P[lo].x, t = dx > 1e-6 ? clamp((x - P[lo].x) / dx, 0, 1) : 0;
        return { s: SS[lo] + t * LEN[lo], i: lo };
    }

    // ---------- Zustand ----------
    const keys = { left: false, right: false, down: false };
    // vehicle: was gerade gefahren wird, chosen: was ausgewählt ist (im BMX-Park geht nur das BMX)
    let jumpQ = false, flipQ = false, vehicle = 'skate', chosen = 'skate', hintDone = false, freeRide = false;
    const POP = () => (vehicle === 'bmx' ? 3.8 : 3.6); // Ollie bzw. Bunnyhop (m/s nach oben)
    let best = 0;
    function loadBest() { best = 0; try { best = parseInt(localStorage.getItem(park.best), 10) || 0; } catch (e) { /* ohne Speicher eben ohne Rekord */ } }
    let st = {};
    const pops = [];
    let clock = 0, cheer = 0, ooh = 0; // Zuschauer: Uhr für die Animation, Jubel (s), Schreck nach einem Sturz (s)
    function reset() {
        st = { mode: 'ready', s: 0.02, v: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, side: -1, h: 0, yaw: 0, yaw0: 0,
            flipT: 0, flips: 0, grab: false, grabT: 0, pitch: 0, tA: 0, T: 1, maxH: 0, crouch: 0, bailT: 0,
            charge: 0, sinceDown: 9, prevDown: false, pumpFlash: 0, pumps: 0,
            rail: null, gx0: 0, bal: 0, balDrift: 0, gName: '', gPts: 0, gParts: null, grinds: 0,
            cleared: [], jumps: 0, cars: 0, lipT: -1, lipTh: 0,
            score: 0, combo: 0, time: SESSION, newBest: false, airs: 0, bails: 0, maxAir: 0 };
        pops.length = 0;
    }
    reset();
    const title = () => (parkId === 'street' ? TXT.titleStreet : parkId === 'bmx' ? TXT.titleBmx : TXT.title) + (freeRide ? ' · ' + TXT.free : '');
    function start() { reset(); st.mode = 'ground'; st.pitch = TH[0]; announce(title()); }
    function pop(text, sub) { pops.push({ text, sub: sub || '', t: 0 }); if (pops.length > 3) pops.shift(); }
    function announce(s) { if (status) status.textContent = s; }
    function takeoff() { st.yaw0 = st.yaw; st.flipT = 0; st.flips = 0; st.grab = false; st.grabT = 0; st.tA = 0; st.maxH = 0; st.charge = 0; st.cleared = []; st.lipT = -1; }
    function toVert(side, vy) { st.mode = 'vert'; st.side = side; st.h = 0; st.vy = vy; st.tA = 0; st.T = 2 * vy / G; }
    function finish() {
        st.mode = 'over';
        if (freeRide) { announce(`${st.score} ${TXT.points}`); return; } // Free Ride zählt nicht für den Rekord
        if (st.score > best) { best = st.score; st.newBest = st.score > 0; try { localStorage.setItem(park.best, String(best)); } catch (e) { /* egal */ } }
        announce(`${TXT.over}: ${st.score} ${TXT.points}. ${st.newBest ? TXT.newRecord : TXT.record + ': ' + best + '.'} ${TXT.again}`);
    }
    function bail() { ooh = 1.3; cheer = 0; st.mode = 'bail'; st.bailT = 0; st.combo = 0; st.grab = false; st.rail = null; st.cleared = []; st.bails++; pop(TXT.bail, TXT.bailSub); announce(TXT.bail); }

    // Drehung muss in Schritten von step stehen (Landung: 180°, Rail: 90° = quer), Flip fast fertig sein. null = Sturz.
    // Kinderfreundlich: ein Flip ab 70 % zählt, ein gerade erst angefangener (unter 25 %) wird einfach abgebrochen
    function checkSpin(step, tol) {
        const spin = st.yaw - st.yaw0, n = Math.round(spin / step), err = Math.abs(spin - n * step);
        if (err > tol || (st.flipT > 0.25 && st.flipT < 0.7)) return null;
        if (st.flipT >= 0.7) st.flips++;
        st.flipT = 0; st.yaw = st.yaw0 + n * step; st.grab = false;
        return n;
    }
    function airTricks(halfs) {
        const parts = []; let pts = 0;
        const flipName = vehicle === 'skate' ? TXT.flip : vehicle === 'bmx' ? TXT.barspin : TXT.whip;
        for (const o of st.cleared) { parts.push(TXT[o.name]); pts += o.pts; } // über Auto oder Reifen gesprungen
        if (st.flips) { parts.push((st.flips === 2 ? TXT.double : st.flips > 2 ? st.flips + '× ' : '') + flipName); pts += Math.round(300 * st.flips * (st.flips > 1 ? 1.3 : 1)); }
        const deg = Math.abs(halfs) * 180;
        if (deg) { parts.push(String(deg)); pts += ({ 180: 100, 360: 250, 540: 450, 720: 700 })[deg] || Math.round(deg * 1.1); }
        if (st.grabT > 0.15) { parts.push(vehicle === 'skate' ? TXT.grab : vehicle === 'bmx' ? TXT.tabletop : TXT.tuck); pts += Math.round(st.grabT * 220); }
        return { parts, pts };
    }
    function award(parts, pts) {
        st.combo = Math.min(5, st.combo + 1);
        const mult = Math.max(1, st.combo);
        st.score += pts * mult;
        const label = parts.join(' + ');
        pop(label, pts + (mult > 1 ? ' × ' + mult : ''));
        announce(`${label}: ${pts * mult}`);
        cheer = Math.max(cheer, Math.min(3, 1.2 + pts * mult / 800)); ooh = 0; // Zuschauer klatschen, bei großen Tricks länger
    }

    // Landung: Drehung in 180°-Schritten (±40°)
    function land() {
        const halfs = checkSpin(Math.PI, 0.87); // ±50°
        if (halfs === null) { bail(); return; }
        if (st.tA < 0.28) return;
        const coping = st.mode === 'ground' && (st.s < 0.01 || st.s > S_END - 0.01);
        st.airs++; st.maxAir = Math.max(st.maxAir, st.maxH);
        const { parts, pts } = airTricks(halfs);
        if (!pts) {
            if (!coping && st.tA < 0.5) return;
            const mult = Math.max(1, st.combo); // ein einfacher Air hält die Kombo, erhöht sie aber nicht
            st.score += Math.round(40 + st.maxH * 45) * mult; pop(TXT.air, Math.round(40 + st.maxH * 45) + (mult > 1 ? ' × ' + mult : ''));
            announce(`${TXT.air}: ${Math.round(40 + st.maxH * 45) * mult}`);
            return;
        }
        award(parts, Math.round(pts + st.maxH * 45));
    }

    // ---------- Grinden (Rails und Ledges im Streetpark) ----------
    const GRIND_FRIC = 1.1;   // m/s² Bremsen auf dem Rail
    const BAL_START = 0.3;    // so schief steht man nach dem Aufsetzen (0.3 bis 0.45, 1 = Sturz)
    const BAL_DRIFT = 0.55;   // so schnell kippt man von allein (pro s)
    const BAL_GROW = 2.2;     // je schiefer, desto schneller kippt man weiter (1/s)
    const BAL_FIX = 2.4;      // Gegensteuern mit ← → (pro s)
    // Aufsetzen auf dem Rail: längs = 50-50 / Grind, quer (90°) = Boardslide / Feeble
    function lockRail(r) {
        const n = checkSpin(Math.PI / 2, 0.5);
        if (n === null) { st.s = sFromX(st.x).s; bail(); return; }
        const halfs = Math.trunc(n / 2), slide = n % 2 !== 0, t = airTricks(halfs);
        st.mode = 'grind'; st.rail = r; st.y = r.h; st.gx0 = st.x; st.v = clamp(st.vx, -VMAX, VMAX); st.pitch = 0;
        // man setzt nie ganz gerade auf: leicht schief, und es kippt weiter in diese Richtung
        const sd = Math.random() < 0.5 ? -1 : 1;
        st.bal = sd * (BAL_START + 0.15 * Math.random()); st.balDrift = sd * BAL_DRIFT;
        st.gParts = t.parts; st.gPts = t.pts; st.gSlide = slide;
        st.gName = vehicle === 'skate' ? (slide ? TXT.boardslide : r.type === 'ledge' ? TXT.fiveO : TXT.fifty)
            : slide ? TXT.feeble : vehicle === 'bmx' ? TXT.peg : TXT.grind;
        announce(st.gName);
    }
    function endGrind(vy) {
        const r = st.rail, dist = Math.abs(st.x - st.gx0);
        st.grinds++;
        award([...st.gParts, st.gName], Math.round(st.gPts + (80 + dist * 60) * (st.gSlide ? 1.3 : 1)));
        // aus dem Boardslide zurück auf längs drehen
        st.yaw = Math.round(st.yaw / Math.PI) * Math.PI;
        takeoff(); st.rail = null; st.mode = 'air';
        st.x = clamp(st.x, r.x0, r.x1); st.y = r.h + 0.01; st.vx = st.v; st.vy = vy; st.pitch = 0;
    }
    function grindStep(dt) {
        const r = st.rail;
        st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), GRIND_FRIC * dt);
        st.x += st.v * dt;
        st.bal += (st.balDrift + BAL_GROW * st.bal) * dt;
        if (keys.left) st.bal -= BAL_FIX * dt;
        if (keys.right) st.bal += BAL_FIX * dt;
        st.pitch = st.bal * 0.4;
        if (Math.abs(st.bal) >= 1) { st.s = sFromX(st.x).s; bail(); return; }
        if (jumpQ) { jumpQ = false; return endGrind(3.2); } // Ollie raus: Flip und Drehung gehen wieder
        if (st.x <= r.x0 || st.x >= r.x1 || Math.abs(st.v) < 0.3) endGrind(0);
    }

    // ---------- Physik ----------
    function update(dt) {
        for (const p of pops) p.t += dt;
        while (pops.length && pops[0].t > 2.2) pops.shift();
        st.pumpFlash = Math.max(0, st.pumpFlash - dt);
        clock += dt; cheer = Math.max(0, cheer - dt); ooh = Math.max(0, ooh - dt);
        if (st.mode === 'ready' || st.mode === 'over') return;
        st.tRun = (st.tRun || 0) + dt; // gefahrene Zeit (auch im Free Ride), für die Hinweise
        if (!freeRide) st.time = Math.max(0, st.time - dt);
        // Rails stehen hinter der Fahrlinie: beim Grinden rückt der Fahrer nach hinten, danach wieder nach vorn
        st.z += ((st.mode === 'grind' ? st.rail.z : st.mode === 'bail' ? st.z : 0) - st.z) * Math.min(1, dt * 14);
        if (st.mode === 'bail') {
            st.bailT += dt;
            if (st.bailT > 1.4) {
                if (st.time <= 0 && !freeRide) return finish();
                Object.assign(st, { mode: 'ground', s: 0.02, v: 0, z: 0, yaw: 0, flipT: 0, pitch: TH[0], bailT: 0, charge: 0 });
            }
            return;
        }
        const inAir = st.mode === 'air' || st.mode === 'vert';
        st.crouch += (((keys.down || (inAir && st.grab)) ? 1 : 0) - st.crouch) * Math.min(1, dt * 10);
        if (st.mode === 'ground') groundStep(dt); else if (st.mode === 'grind') grindStep(dt); else airStep(dt);
        if (st.mode === 'ground' && st.time <= 0 && !freeRide) finish();
    }

    // Hindernisse (BMX-Park): Höhe über dem Boden an der Stelle x, 0 = nicht dort. Das Auto hat vorne und hinten
    // die niedrigere Motorhaube und den Kofferraum, in der Mitte das Dach
    function obstTop(o, x) {
        if (x <= o.x0 || x >= o.x1) return 0;
        if (o.type === 'car') return Math.abs(x - (o.x0 + o.x1) / 2) < 0.95 ? o.h : 0.85;
        return o.h;
    }
    function crash(o, dir) { st.s = sFromX(dir >= 0 ? o.x0 - 0.5 : o.x1 + 0.5).s; bail(); }
    // Bunnyhop / Ollie mitten im Absprung: Schub senkrecht zur Rampe
    function hop(th) { st.vx -= POP() * Math.sin(th); st.vy += POP() * Math.cos(th); st.lipT = -1; }
    function launchLip(l) {
        const th = TH[segAt(l.s - l.dir * 0.05)], v = st.v, p = posAt(l.s);
        takeoff(); st.mode = 'air'; st.x = p.x; st.y = p.y + 0.02;
        st.vx = v * Math.cos(th); st.vy = v * Math.sin(th); st.lipT = 0; st.lipTh = th;
        if (jumpQ) { jumpQ = false; hop(th); }
    }

    function groundStep(dt) {
        flipQ = false;
        let th = TH[segAt(st.s)];
        const sn = Math.sin(th);
        st.v += -G * sn * dt;
        const sg = Math.sign(st.v);
        st.v -= sg * Math.min(Math.abs(st.v), (FRIC_A + FRIC_B * st.v * st.v) * dt);
        // Pumpen: in der Hocke bergab laden, unten im Übergang loslassen (strecken) = Schub
        const vert = st.v * sn; // < 0: es geht bergab, > 0: bergauf
        st.sinceDown = vert < -0.3 && Math.abs(sn) > 0.35 ? 0 : st.sinceDown + dt;
        if (keys.down) {
            if (vert < -0.3) st.charge = Math.min(1, st.charge + CHARGE_RATE * Math.abs(sn) * dt);
            else if (vert > 0.3 && Math.abs(sn) > 0.25) {
                st.v -= sg * Math.min(Math.abs(st.v), CROUCH_DRAG * Math.abs(sn) * dt);
                st.charge = Math.max(0, st.charge - 2 * dt);
            }
        } else if (st.prevDown) {
            // gut: im unteren Bogen loslassen (Wand schon flacher, aber noch nicht lange im Flachen)
            const timing = Math.abs(sn) < 0.5 && vert <= 0.3 ? clamp(1 - 0.7 * st.sinceDown / PUMP_LATE, 0.3, 1) : 0;
            if (st.charge > 0.05 && timing > 0 && Math.abs(st.v) > 0.5) {
                st.v += sg * PUMP * st.charge * timing;
                if (st.charge * timing > 0.6) { st.pumpFlash = 0.7; st.pumps++; hintDone = true; }
            }
            st.charge = 0;
        }
        st.prevDown = keys.down;
        if (Math.abs(sn) < 0.12) { // anschieben auf flachem Boden
            if (vehicle === 'bmx') { // treten: kräftiger, aber nur bis 7.5 m/s inklusive Höhe (oben auf der Funbox zählt die mit)
                const e = Math.sqrt(st.v * st.v + 2 * G * posAt(st.s).y);
                if (keys.left && e < 7.5 && st.v < 0.5) st.v -= 4 * dt;
                if (keys.right && e < 7.5 && st.v > -0.5) st.v += 4 * dt;
                if ((keys.left && st.v > 0.5) || (keys.right && st.v < -0.5)) st.v -= Math.sign(st.v) * 4 * dt; // Rücktritt = bremsen
            } else {
                if (keys.left && st.v > -6) st.v -= 3.5 * dt;
                if (keys.right && st.v < 6) st.v += 3.5 * dt;
            }
        }
        st.v = clamp(st.v, -VMAX, VMAX);
        const s0 = st.s; st.s += st.v * dt;
        if (st.s >= S_END) { if (st.v > 1.2) { takeoff(); return toVert(1, st.v); } st.s = S_END - 1e-3; st.v = -Math.abs(st.v) * 0.5; }
        else if (st.s <= 0) { if (st.v < -1.2) { takeoff(); return toVert(-1, -st.v); } st.s = 1e-3; st.v = Math.abs(st.v) * 0.5; }
        for (const l of LIPS) { // über die Kante der Absprungrampe: ab in die Luft
            if (l.dir * st.v > 0.3 && (l.dir > 0 ? s0 < l.s && st.s >= l.s : s0 > l.s && st.s <= l.s)) return launchLip(l);
        }
        if (OBST.length) { // ins Hindernis gefahren
            const fx = posAt(st.s).x + Math.sign(st.v) * 0.45;
            for (const o of OBST) if (obstTop(o, fx) > 0) return crash(o, st.v);
        }
        if (jumpQ) { // Ollie
            jumpQ = false;
            const p = posAt(st.s); takeoff(); st.mode = 'air';
            st.x = p.x; st.y = p.y + 0.02;
            st.vx = st.v * Math.cos(th) - POP() * Math.sin(th); st.vy = st.v * Math.sin(th) + POP() * Math.cos(th);
            return;
        }
        th = TH[segAt(st.s)];
        st.pitch += angDiff(th, st.pitch) * Math.min(1, dt * 16);
    }

    function airStep(dt) {
        // etwas zu spät an der Kante gedrückt: bis 0.15 s danach zählt der Bunnyhop noch
        if (jumpQ && st.mode === 'air' && st.lipT >= 0 && st.tA < 0.15) hop(st.lipTh);
        jumpQ = false;
        st.prevDown = false;
        st.tA += dt;
        if (keys.left) st.yaw += SPIN_RATE * dt;
        if (keys.right) st.yaw -= SPIN_RATE * dt;
        if (!keys.left && !keys.right) { // losgelassen: zurechtrutschen zur nächsten geraden Stellung, egal wie schief
            const spin = st.yaw - st.yaw0, err = spin - Math.round(spin / Math.PI) * Math.PI;
            // über einem Rail bleibt eine gewollte Querstellung (Boardslide) stehen
            const overRail = st.mode === 'air' && RAILS.some((r) => st.x > r.x0 - 1 && st.x < r.x1 + 1);
            if (!(overRail && Math.abs(err) > 1.05)) st.yaw -= Math.sign(err) * Math.min(Math.abs(err), SETTLE_RATE * dt);
        }
        if (flipQ && st.flipT === 0) st.flipT = 1e-4;
        flipQ = false;
        if (st.flipT > 0) { st.flipT += dt / FLIP_TIME; if (st.flipT >= 1) { st.flipT = 0; st.flips++; } }
        st.grab = keys.down; if (st.grab) st.grabT += dt;
        if (st.mode === 'vert') {
            st.h += st.vy * dt; st.vy -= G * dt; st.maxH = Math.max(st.maxH, st.h);
            const ph = clamp(st.tA / Math.max(0.2, st.T), 0, 1);
            st.pitch = st.side * Math.PI / 2 * (1 - 0.55 * Math.sin(Math.PI * ph));
            if (st.h <= 0 && st.vy < 0) {
                st.h = 0; st.mode = 'ground';
                st.s = st.side > 0 ? S_END - 1e-3 : 1e-3; st.v = st.side > 0 ? st.vy : -st.vy;
                st.pitch = TH[segAt(st.s)];
                land();
            }
            return;
        }
        const y0 = st.y, x0 = st.x;
        st.vy -= G * dt; st.x += st.vx * dt; st.y += st.vy * dt;
        if (st.vy < 0) for (const r of RAILS) { // von oben aufs Rail: Grind
            if (y0 >= r.h && st.y <= r.h && st.x > r.x0 + 0.15 && st.x < r.x1 - 0.15) { lockRail(r); return; }
        }
        for (const o of OBST) { // Räder (±0.3 m) berühren das Hindernis: Sturz; über die Mitte hinweg: geschafft
            const top = Math.max(obstTop(o, st.x - 0.3), obstTop(o, st.x + 0.3));
            if (top > 0 && st.y < top) return crash(o, st.vx);
            const mid = (o.x0 + o.x1) / 2;
            if ((x0 - mid) * (st.x - mid) <= 0 && !st.cleared.includes(o)) { st.cleared.push(o); st.jumps++; if (o.type === 'car') st.cars++; }
        }
        const gy = groundY(st.x);
        st.maxH = Math.max(st.maxH, st.y - gy);
        st.pitch -= st.pitch * Math.min(1, dt * 2.5);
        if (Math.abs(st.x) >= XMAX - 0.02) {
            const side = Math.sign(st.x); st.x = side * (XMAX - 0.02);
            if (st.y >= R) { st.mode = 'vert'; st.side = side; st.h = st.y - R; st.T = st.tA + 2 * Math.max(0.3, st.vy) / G; }
            else st.vx = -st.vx * 0.3;
        } else if (st.vy < 0 && st.y <= gy) {
            // auf der steilen Rückseite einer Absprungrampe aufgesetzt: Sturz
            if (park.gap && Math.abs(st.x) > KA - KBACK + 0.02 && Math.abs(st.x) < KA - 0.04) { st.s = sFromX(st.x).s; bail(); return; }
            const f = sFromX(st.x), th = TH[f.i];
            const vt = st.vx * Math.cos(th) + st.vy * Math.sin(th);
            const vn = -st.vx * Math.sin(th) + st.vy * Math.cos(th);
            st.mode = 'ground'; st.s = clamp(f.s, 1e-3, S_END - 1e-3);
            // in die Knie gehen: flache Landungen (unter 40°) behalten 95 % des Tempos, steile 88 % (Sprung über die Funbox bis in die Wand)
            const sp = Math.hypot(st.vx, st.vy), flat = Math.abs(Math.atan2(Math.abs(vn), Math.abs(vt))) < 0.7;
            st.v = Math.sign(vt || st.vx) * Math.min(Math.max(Math.abs(vt) + 0.3 * Math.abs(vn), (flat ? 0.95 : 0.88) * sp), VMAX);
            st.pitch = th;
            land();
        }
    }

    // ---------- 3D ----------
    let eye = [0, 5, 11], fwd = [0, 0, -1], right = [1, 0, 0], up = [0, 1, 0], camX = 0, camY = 0;
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    function setCam(cx, cy) {
        eye = [cx, 5.2 + cy * 0.6, 11.5];
        fwd = norm([0, 1.5 + cy - eye[1], -eye[2]]);
        right = norm(cross(fwd, [0, 1, 0])); up = cross(right, fwd);
    }
    function proj(x, y, z) {
        const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
        const zc = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
        const f = FOCAL / Math.max(0.1, zc);
        return [CW / 2 + (dx * right[0] + dy * right[1] + dz * right[2]) * f, CH / 2 - (dx * up[0] + dy * up[1] + dz * up[2]) * f, zc];
    }
    function path(pts) { ctx.beginPath(); pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }
    const rgb = (c, s) => `rgb(${Math.min(255, c[0] * s) | 0},${Math.min(255, c[1] * s) | 0},${Math.min(255, c[2] * s) | 0})`;
    const LIGHT = norm([-0.35, 0.85, 0.4]);

    function buildQuads() {
        for (let i = 0; i < NS; i++) {
            const a = P[i], b = P[i + 1], n = [-Math.sin(TH[i]), Math.cos(TH[i]), 0];
            const midX = (a.x + b.x) / 2, ax = Math.abs(midX);
            const box = park.gap ? ax > KA - KBACK - 0.01 && ax < KB : ax < KB;
            const col = ax > W ? park.wall : box ? park.box : park.flat;
            const sh = 0.66 + 0.34 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1]);
            for (let j = 0; j < 4; j++) {
                const z0 = -ZW + j * ZW / 2, z1 = z0 + ZW / 2;
                QUADS.push({ pts: [[a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], [a.x, a.y, z1]], c: [midX, (a.y + b.y) / 2, (z0 + z1) / 2], n,
                    fill: rgb(col, sh * (i % 2 ? 1 : 0.97)) });
            }
        }
    }
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Hintergrund Halfpipe: Harzkamm mit Brocken und Tannen
    const RIDGE = [];
    for (let x = -140; x <= 140; x += 7) RIDGE.push([x, 9 + 5 * Math.sin(x * 0.045) + 3 * Math.sin(x * 0.13 + 1) + (Math.abs(x - 30) < 18 ? 9 * Math.cos((x - 30) / 18 * Math.PI / 2) : 0), -90]);
    const TREES = [];
    for (let i = 0; i < 46; i++) TREES.push({ x: -40 + rnd() * 80, z: -12 - rnd() * 16, h: 4 + rnd() * 4 });
    TREES.sort((a, b) => a.z - b.z);
    // Hintergrund Streetpark: Häuser der Stadt, zwei Reihen
    const HOUSES = [];
    for (let row = 0; row < 2; row++) {
        const cols = row ? ['#b3bcc6', '#a9b4bf', '#bcc3cb'] : ['#b98d78', '#a3a9b0', '#c9b48e', '#9aa6a0', '#b7a29a'];
        for (let x = -110; x < 110;) {
            const w = 7 + rnd() * 9, h = (row ? 9 : 4) + rnd() * (row ? 10 : 5);
            HOUSES.push({ x0: x, x1: x + w - 1, h, z: row ? -80 : -48, row, win: rnd() < 0.75, col: cols[(rnd() * cols.length) | 0] });
            x += w + (row ? 0 : rnd() * 4);
        }
    }
    // Werbebanner: ausgedachte Marken im Stil typischer Skate-Labels
    const BRANDS = [
        { name: 'BROCKEN BOARDS', bg: '#111111', fg: '#ffffff', bar: '#d33b2f' },
        { name: 'ACID GRIP', bg: '#e8ff3a', fg: '#111111' },
        { name: 'COPING CLUB', bg: '#d33b2f', fg: '#ffffff' },
        { name: 'NORTHSIDE TRUCKS', bg: '#1f2d4d', fg: '#ff9a2e' },
        { name: 'BAILOUT WHEELS', bg: '#ffffff', fg: '#d33b2f', bar: '#111111' },
        { name: 'GRIND HOUSE', bg: '#c2187a', fg: '#ffffff' },
        { name: 'SHRED SOCIETY', bg: '#1c8c7a', fg: '#0d1512' },
        { name: 'KICKTAIL CO.', bg: '#f2c230', fg: '#1d1d1d', bar: '#1d1d1d' },
    ];
    // Rechteck in der Ebene z = const als lokales Koordinatensystem uw × uh (die Perspektive dort ist praktisch affin)
    function plane(x0, x1, y0, y1, z, uw, uh) {
        const a = proj(x0, y1, z), c = proj(x1, y1, z), d = proj(x0, y0, z);
        ctx.transform((c[0] - a[0]) / uw, (c[1] - a[1]) / uw, (d[0] - a[0]) / uh, (d[1] - a[1]) / uh, a[0], a[1]);
    }
    function banner(x0, x1, y0, y1, z, b) {
        ctx.save();
        plane(x0, x1, y0, y1, z, 100, 20);
        ctx.fillStyle = b.bg; ctx.fillRect(0, 0, 100, 20);
        if (b.bar) { ctx.fillStyle = b.bar; ctx.fillRect(0, 16.5, 100, 3.5); }
        ctx.fillStyle = b.fg; ctx.font = '900 13px Impact, "Arial Black", system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(b.name, 50, b.bar ? 13.5 : 14.5, 92);
        ctx.restore();
    }
    // Graffiti: Schriftzug mit schwarzer Kontur, farbigem Rand, Farbwolke dahinter und Farbnasen
    const SPRAY = {
        pink: ['#ff4fa3', '#2b1a5e', 'rgba(120,200,255,.55)'], cyan: ['#35d0ff', '#0f2a4a', 'rgba(255,230,90,.55)'],
        yellow: ['#ffd23a', '#7a1f1f', 'rgba(255,90,90,.5)'], green: ['#7cff6b', '#14361a', 'rgba(180,140,255,.5)'],
        orange: ['#ff7a2e', '#2a1408', 'rgba(60,200,180,.5)'], lilac: ['#c49bff', '#1d1238', 'rgba(255,150,200,.5)'],
    };
    // Tag: schnell hingekritzelt, einfarbig, mit Schwung darunter
    function scribble(g, z) {
        const uh = 100 * (g.y1 - g.y0) / (g.x1 - g.x0), fs = uh * 0.62;
        ctx.save();
        plane(g.x0, g.x1, g.y0, g.y1, z, 100, uh);
        ctx.translate(50, uh / 2); ctx.rotate(g.rot || 0); ctx.transform(1, 0, -0.25, 1, 0, 0); // schräg wie Handschrift
        ctx.font = `italic 700 ${fs.toFixed(1)}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = g.tag; ctx.fillText(g.t, 0, 0, 88);
        ctx.strokeStyle = g.tag; ctx.lineWidth = Math.max(1, fs * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
        ctx.moveTo(-40, fs * 0.5); ctx.quadraticCurveTo(0, fs * 0.75, 44, fs * 0.36); ctx.stroke();
        ctx.restore();
    }
    function graffito(g, z) {
        if (g.tag) return scribble(g, z);
        const [fill, line, cloud] = SPRAY[g.c], uh = 100 * (g.y1 - g.y0) / (g.x1 - g.x0), fs = uh * 0.78;
        let h = 0; for (const ch of g.t) h = (h * 31 + ch.charCodeAt(0)) % 9973; // fester Zufall je Schriftzug
        const r = () => (h = (h * 16807) % 2147483647) / 2147483647;
        ctx.save();
        plane(g.x0, g.x1, g.y0, g.y1, z, 100, uh);
        ctx.translate(50, uh / 2); ctx.rotate(g.rot || 0);
        ctx.fillStyle = cloud;
        for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(-42 + k * 14, (r() - 0.5) * fs * 0.4, 10 + r() * 8, fs * (0.45 + r() * 0.25), 0, 0, 7); ctx.fill(); }
        ctx.font = `900 ${fs.toFixed(1)}px "Arial Black", Impact, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.strokeStyle = '#141414'; ctx.lineWidth = fs * 0.36; ctx.strokeText(g.t, 0, 0, 90);
        ctx.strokeStyle = line; ctx.lineWidth = fs * 0.2; ctx.strokeText(g.t, 0, 0, 90);
        ctx.fillStyle = fill; ctx.fillText(g.t, 0, 0, 90);
        ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, fs * 0.06); ctx.lineCap = 'round'; ctx.beginPath();
        for (let k = 0; k < 5; k++) { const x = -38 + r() * 76, y = fs * 0.42; ctx.moveTo(x, y); ctx.lineTo(x, y + fs * (0.15 + r() * 0.45)); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.8)'; // Glanzpunkte
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-34 + r() * 68, -fs * 0.2, fs * 0.05, 0, 7); ctx.fill(); }
        ctx.restore();
    }
    function bannerRow(x0, x1, y0, y1, z, first, poles, brands = BRANDS) {
        const n = Math.max(1, Math.round((x1 - x0) / 4.2)), w = (x1 - x0) / n;
        for (let i = 0; i < n; i++) {
            const a = x0 + i * w + 0.12, b = x0 + (i + 1) * w - 0.12;
            if (poles) {
                ctx.strokeStyle = '#5b6166'; ctx.lineWidth = 2; ctx.beginPath();
                for (const px of [a + 0.15, b - 0.15]) { const p = proj(px, 0, z), q = proj(px, y1, z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
                ctx.stroke();
            }
            banner(a, b, y0, y1, z, brands[(first + i) % brands.length]);
        }
    }

    // Zuschauer: Skater vor der Rückwand, manche mit Board. Sie klatschen nach Tricks (versetzt, nicht im Takt),
    // reißen bei großen Tricks die Arme hoch und springen, nach einem Sturz Hände an den Kopf.
    function makeCrowd(spots) {
        const shirts = ['#d33b2f', '#1f2d4d', '#f2c230', '#1c8c7a', '#111111', '#c2187a', '#e8e4da', '#6b4fa0'];
        const pants = ['#2b3440', '#3a5a8c', '#1d1d1d', '#6b6256', '#4a4f55'];
        const skins = ['#f0c8a0', '#d9a77c', '#a8714a', '#7a4a2c', '#f5d6b8'];
        const tops = ['#111111', '#d33b2f', '#3a2a1a', '#e8ff3a', '#1f2d4d', null];
        const list = spots.map(([x, dz]) => ({ x: x + (rnd() - 0.5) * 0.4, dz: dz + (rnd() - 0.5) * 0.5, k: 0.88 + rnd() * 0.2, ph: rnd() * 7,
            shirt: shirts[(rnd() * shirts.length) | 0], pants: pants[(rnd() * pants.length) | 0], skin: skins[(rnd() * skins.length) | 0],
            top: tops[(rnd() * tops.length) | 0], board: rnd() < 0.45, deck: ['#3b2a1a', '#d33b2f', '#1c8c7a', '#f2c230'][(rnd() * 4) | 0], wild: rnd() < 0.5 }));
        return list.sort((a, b) => a.dz - b.dz);
    }
    // Streetpark: vor der Mauer. Halfpipe: oben auf den Plattformen, links einer, rechts zwei, hinter der Fahrlinie
    const CROWD = makeCrowd([-8.4, -7.6, -5.2, -4.5, -1.6, 0.9, 1.7, 4.4, 6.3, 7.1, 8.6].map((x) => [x, 0]));
    const DECK_CROWD = makeCrowd([[-10.3, -2.3], [9.8, -2.4], [10.5, -1.7]]);
    function drawCrowd(people, z0, y0) {
        const seg = (a, b, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * FOCAL / a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
        const blob = (a, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(1, r * FOCAL / a[2]), 0, 7); ctx.fill(); };
        ctx.lineCap = 'round';
        for (const c of people) {
            const z = z0 + c.dz, k = c.k, t = clock + c.ph;
            const big = cheer > 1.6 && c.wild, lift = big ? Math.abs(Math.sin(t * 7)) * 0.18 : 0;
            const P3 = (dx, y, dz) => proj(c.x + dx, y0 + y + lift, z + (dz || 0));
            if (c.board) { // Board hochkant daneben
                const a = proj(c.x + 0.38, y0 + 0.02, z), b = proj(c.x + 0.42, y0 + 0.8 * k, z);
                seg(a, b, c.deck, 0.07); blob(proj(c.x + 0.33, y0 + 0.12, z + 0.05), 0.03, '#f2efe6'); blob(proj(c.x + 0.36, y0 + 0.7 * k, z + 0.05), 0.03, '#f2efe6');
            }
            const hip = P3(0, 0.82 * k), neck = P3(0, 1.32 * k), head = P3(0, 1.48 * k);
            const sL = P3(-0.15, 1.28 * k), sR = P3(0.15, 1.28 * k);
            seg(P3(-0.11, 0), hip, c.pants, 0.11); seg(P3(0.11, 0), hip, c.pants, 0.11);
            seg(hip, neck, c.shirt, 0.2);
            let hL, hR;
            if (ooh > 0) { hL = P3(-0.12, 1.6 * k, 0.05); hR = P3(0.12, 1.6 * k, 0.05); } // „Uff!“
            else if (big) { hL = P3(-0.3, 1.85 * k); hR = P3(0.3, 1.85 * k); } // Arme hoch
            else if (cheer > 0) { const o = 0.03 + 0.11 * Math.abs(Math.sin(t * 13)); hL = P3(-o, 1.12 * k, 0.22); hR = P3(o, 1.12 * k, 0.22); } // klatschen
            else { const sw = Math.sin(t * 1.3) * 0.03; hL = P3(-0.22 + sw, 0.86 * k); hR = c.board ? P3(0.36, 0.78 * k) : P3(0.22 + sw, 0.86 * k); }
            seg(sL, hL, c.shirt, 0.07); seg(sR, hR, c.shirt, 0.07); blob(hL, 0.04, c.skin); blob(hR, 0.04, c.skin);
            blob(head, 0.11, c.skin);
            if (c.top) blob(P3(0, 1.53 * k), 0.095, c.top); // Mütze oder Haare
        }
    }

    // Mountainbike, vorne links an die Seitenwand der Halfpipe gelehnt (Seitenansicht in der Ebene z)
    function drawBike(x, z) {
        const P = (dx, y) => proj(x + dx, y, z), s = FOCAL / P(0, 0)[2];
        const bar = (a, b, col, w) => { const p = P(a[0], a[1]), q = P(b[0], b[1]); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * s); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
        const wheel = (dx) => {
            const c = P(dx, 0.36);
            ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = Math.max(2, 0.07 * s); ctx.beginPath(); ctx.arc(c[0], c[1], 0.33 * s, 0, 7); ctx.stroke(); // Stollenreifen
            ctx.strokeStyle = '#2e2e2e'; ctx.setLineDash([Math.max(1, 0.03 * s), Math.max(1, 0.035 * s)]); ctx.lineWidth = Math.max(1, 0.03 * s);
            ctx.beginPath(); ctx.arc(c[0], c[1], 0.375 * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(190,195,200,.8)'; ctx.lineWidth = 1; ctx.beginPath(); // Speichen
            for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + Math.cos(a) * 0.3 * s, c[1] + Math.sin(a) * 0.3 * s); }
            ctx.stroke();
            ctx.fillStyle = '#9aa3a8'; ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1.5, 0.04 * s), 0, 7); ctx.fill();
        };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        wheel(-0.55); wheel(0.55);
        const BB = [-0.05, 0.33], SEAT = [-0.2, 0.86], HEAD = [0.4, 0.9], REAR = [-0.55, 0.36], FRONT = [0.55, 0.36];
        const frame = '#ff6a13';
        bar(REAR, BB, frame, 0.045); bar(REAR, [-0.24, 0.78], frame, 0.04);       // Kettenstrebe, Sitzstrebe
        bar(BB, SEAT, frame, 0.06); bar(BB, HEAD, frame, 0.07); bar([-0.22, 0.8], HEAD, frame, 0.06); // Sitzrohr, Unterrohr, Oberrohr
        bar([-0.12, 0.62], [-0.32, 0.6], '#1b1b1b', 0.05);                      // Dämpfer hinten
        bar(HEAD, [0.48, 0.6], '#d8dde0', 0.055); bar([0.48, 0.6], FRONT, '#1b1b1b', 0.045); // Federgabel
        bar(HEAD, [0.36, 1.02], '#1b1b1b', 0.04); bar([0.25, 1.04], [0.47, 1.0], '#1b1b1b', 0.035); // Vorbau, Lenker
        bar(SEAT, [-0.22, 0.95], '#1b1b1b', 0.03); bar([-0.34, 0.97], [-0.1, 0.96], '#1b1b1b', 0.06); // Sattelstütze, Sattel
        const c = P(BB[0], BB[1]); ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, 0.02 * s); ctx.beginPath(); ctx.arc(c[0], c[1], 0.09 * s, 0, 7); ctx.stroke(); // Kettenblatt
        bar(BB, [0.1, 0.2], '#1b1b1b', 0.03); bar([0.06, 0.2], [0.16, 0.2], '#333', 0.04); // Kurbel, Pedal
    }

    // Schwarz-weißer Hund: trabt vor den Zuschauern hin und her, wedelt, hüpft und bellt nach Tricks
    function drawDog(z) {
        const walk = Math.sin(clock * 0.22), f = Math.cos(clock * 0.22) >= 0 ? 1 : -1; // Blickrichtung = Laufrichtung
        const x = -3 + walk * 2.4, moving = Math.abs(Math.cos(clock * 0.22)) > 0.15 && !cheer;
        const lift = cheer > 0 ? Math.abs(Math.sin(clock * 9)) * 0.14 : 0;
        const P3 = (dx, y) => proj(x + f * dx, y + lift, z), s = FOCAL / P3(0, 0)[2];
        const ell = (dx, y, rx, ry, col, rot) => { const p = P3(dx, y); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx * s, ry * s, (rot || 0) * -f, 0, 7); ctx.fill(); };
        const leg = (dx, ph, col) => {
            const sw = moving ? Math.sin(clock * 10 + ph) * 0.06 : 0, a = P3(dx, 0.3), b = P3(dx + sw, lift ? 0.04 : 0);
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.05 * s); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        };
        ctx.lineCap = 'round';
        leg(-0.2, 0, '#222'); leg(0.17, Math.PI, '#f4f4f0'); // hintere Beine (weiter weg)
        const wag = Math.sin(clock * (cheer ? 22 : 7)) * 0.09; // Schwanz
        const t0 = P3(-0.27, 0.42), t1 = P3(-0.44, 0.6 + wag), t2 = P3(-0.48, 0.66 + wag * 1.2);
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = Math.max(1, 0.045 * s); ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
        ctx.strokeStyle = '#f4f4f0'; ctx.beginPath(); ctx.moveTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]); ctx.stroke();
        ell(0, 0.38, 0.3, 0.12, '#f4f4f0');            // Körper weiß
        ell(-0.07, 0.43, 0.17, 0.08, '#1a1a1a', 0.1);  // schwarzer Fleck auf dem Rücken
        ell(0.2, 0.36, 0.07, 0.06, '#1a1a1a');         // Fleck an der Schulter
        leg(-0.17, Math.PI, '#1a1a1a'); leg(0.2, 0, '#f4f4f0'); // vordere Beine
        ell(0.3, 0.53, 0.1, 0.09, '#1a1a1a');          // Kopf schwarz
        ell(0.39, 0.49, 0.07, 0.045, '#f4f4f0');       // weiße Schnauze
        ell(0.46, 0.5, 0.022, 0.018, '#111');          // Nase
        ell(0.33, 0.56, 0.018, 0.018, '#f4f4f0');      // Auge
        ell(0.25, 0.58, 0.04, 0.07, '#111', 0.5);      // Ohr
        if (cheer > 0 && Math.sin(clock * 4) > 0.2) txt(TXT.woof, P3(0.55, 0.85)[0], P3(0.55, 0.85)[1], 13, f > 0 ? 'left' : 'right', '#1d2a22');
    }

    // Backsteinmauer: Ziegel 0.5 × 0.25 m im Läuferverband, einzelne Steine dunkler, oben eine Betonabdeckung
    const BRICK_W = 0.5, BRICK_H = 0.25, DARK_BRICKS = [];
    for (let i = 0; i < 140; i++) DARK_BRICKS.push({ c: (rnd() * 72) | 0, r: (rnd() * 10) | 0, s: rnd() < 0.5 ? '#8a3f2c' : '#b0563b' });
    function drawBrickWall(x0, x1, h, z) {
        ctx.fillStyle = '#9e4a33'; path([[x0, 0, z], [x1, 0, z], [x1, h, z], [x0, h, z]]); ctx.fill();
        const rows = Math.floor(h / BRICK_H);
        for (const b of DARK_BRICKS) {
            if (b.r >= rows) continue;
            const bx = x0 + b.c * BRICK_W + (b.r % 2 ? BRICK_W / 2 : 0), by = b.r * BRICK_H;
            if (bx + BRICK_W > x1) continue;
            ctx.fillStyle = b.s; path([[bx, by, z], [bx + BRICK_W, by, z], [bx + BRICK_W, by + BRICK_H, z], [bx, by + BRICK_H, z]]); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(214,204,188,.75)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let r = 0; r <= rows; r++) { // Lagerfugen
            const a = proj(x0, r * BRICK_H, z), b = proj(x1, r * BRICK_H, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            if (r === rows) break;
            for (let x = x0 + (r % 2 ? BRICK_W / 2 : BRICK_W); x < x1; x += BRICK_W) { // Stoßfugen, versetzt
                const p = proj(x, r * BRICK_H, z), q = proj(x, (r + 1) * BRICK_H, z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
            }
        }
        ctx.stroke();
        ctx.fillStyle = '#b9b7b1'; path([[x0 - 0.05, h, z + 0.02], [x1 + 0.05, h, z + 0.02], [x1 + 0.05, h + 0.12, z + 0.02], [x0 - 0.05, h + 0.12, z + 0.02]]); ctx.fill();
    }

    // ---------- BMX-Park: Schrottauto, Reifen, Wellblechzaun, Wrackstapel ----------
    // erst hier gewürfelt, damit die anderen Parks genauso aussehen wie vorher
    const BMX_BRANDS = [
        { name: 'RUSTY PEG CO.', bg: '#2a2a2a', fg: '#ff8a2a', bar: '#ff8a2a' },
        { name: 'GAP JUMPERS', bg: '#f2c230', fg: '#1d1d1d' },
        { name: 'HARZ DIRT CREW', bg: '#3c6e3a', fg: '#ffffff' },
        { name: 'TWENTY INCH', bg: '#ffffff', fg: '#1f2d4d', bar: '#d33b2f' },
    ];
    const WRECKS = [ // Stapel hinter dem Zaun: x, Höhe im Stapel, Farbe
        [-13.5, 0, [150, 70, 45]], [-13.2, 1, [78, 104, 132]], [-13.8, 2, [120, 120, 96]],
        [-9.6, 0, [96, 120, 80]], [-9.9, 1, [170, 150, 110]],
        [10.8, 0, [130, 60, 60]], [11.2, 1, [90, 96, 104]], [10.6, 2, [176, 120, 60]],
        [14.8, 0, [70, 90, 120]],
    ];
    const BMX_CROWD = makeCrowd([[-12.4, 0], [-6.8, 0], [-5.9, 0], [6.4, 0], [12.9, 0]]);
    const RUST = [];
    for (let i = 0; i < 7; i++) RUST.push([-1.6 + rnd() * 3.2, 0.32 + rnd() * 0.4, 0.07 + rnd() * 0.12]);
    // Quader, nur die zur Kamera zeigenden Seiten (konvex, also ohne Sortieren)
    function box(x0, x1, y0, y1, z0, z1, col) {
        const F = [
            [[0, 0, 1], [(x0 + x1) / 2, (y0 + y1) / 2, z1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.9],
            [[0, 1, 0], [(x0 + x1) / 2, y1, (z0 + z1) / 2], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1.08],
            [[-1, 0, 0], [x0, (y0 + y1) / 2, (z0 + z1) / 2], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.76],
            [[1, 0, 0], [x1, (y0 + y1) / 2, (z0 + z1) / 2], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 0.7],
        ];
        for (const [n, c, pts, s] of F) {
            if (n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) <= 0) continue;
            ctx.fillStyle = rgb(col, s); path(pts); ctx.fill();
        }
    }
    // Schrottauto (Seitenansicht längs der Fahrlinie): platte Reifen, Rost, gesprungene Scheiben
    function drawCar(cx, cz, y0, col, rust) {
        for (const dx of [-1.2, 1.2]) { // Räder auf der vorderen Seite, oben verdeckt die Karosserie sie
            const c = proj(cx + dx, y0 + 0.27, cz + 0.8), r = 0.3 * FOCAL / c[2];
            ctx.fillStyle = '#1c1c1c'; ctx.beginPath(); ctx.ellipse(c[0], c[1] + r * 0.08, r, r * 0.86, 0, 0, 7); ctx.fill(); // platt
            ctx.fillStyle = '#6d6a64'; ctx.beginPath(); ctx.arc(c[0], c[1], r * 0.42, 0, 7); ctx.fill();
        }
        box(cx - 1.85, cx + 1.85, y0 + 0.28, y0 + 0.85, cz - 0.82, cz + 0.82, col);
        box(cx - 0.95, cx + 0.8, y0 + 0.85, y0 + 1.25, cz - 0.7, cz + 0.7, col.map((v) => v * 0.92));
        const zf = cz + 0.82, zc = cz + 0.7;
        ctx.fillStyle = '#2a3238'; // Seitenfenster
        for (const [a, b] of [[-0.85, -0.12], [0.0, 0.7]]) { path([[cx + a, y0 + 0.9, zc], [cx + b, y0 + 0.9, zc], [cx + b - 0.08, y0 + 1.2, zc], [cx + a + 0.1, y0 + 1.2, zc]]); ctx.fill(); }
        ctx.strokeStyle = 'rgba(220,230,235,.7)'; ctx.lineWidth = 1; ctx.beginPath(); // Sprung in der Scheibe
        const k0 = proj(cx - 0.6, y0 + 1.15, zc), k1 = proj(cx - 0.4, y0 + 1.02, zc), k2 = proj(cx - 0.18, y0 + 1.08, zc), k3 = proj(cx - 0.45, y0 + 0.93, zc);
        ctx.moveTo(k0[0], k0[1]); ctx.lineTo(k1[0], k1[1]); ctx.lineTo(k2[0], k2[1]); ctx.moveTo(k1[0], k1[1]); ctx.lineTo(k3[0], k3[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); // Türfugen
        for (const dx of [-0.95, -0.08, 0.8]) { const p = proj(cx + dx, y0 + 0.3, zf), q = proj(cx + dx, y0 + 0.84, zf); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
        if (rust) for (const [dx, y, r] of RUST) { // Rostflecken
            const p = proj(cx + dx, y0 + y, zf); ctx.fillStyle = 'rgba(122,62,28,.75)';
            ctx.beginPath(); ctx.ellipse(p[0], p[1], r * FOCAL / p[2], r * 0.7 * FOCAL / p[2], 0.4, 0, 7); ctx.fill();
        }
    }
    // Reifenstapel: liegende Reifen übereinander
    function drawTires(xc, zc, n) {
        const ring = (y, r) => { ctx.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * Math.PI * 2, p = proj(xc + Math.cos(a) * r, y, zc + Math.sin(a) * r); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } ctx.closePath(); };
        for (let i = 0; i < n; i++) {
            const y0 = i * 0.16, y1 = y0 + 0.16;
            ctx.beginPath(); // Lauffläche vorne
            for (let k = 0; k <= 10; k++) { const a = k / 10 * Math.PI, p = proj(xc + Math.cos(a) * 0.38, y0, zc + Math.sin(a) * 0.38); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
            for (let k = 10; k >= 0; k--) { const a = k / 10 * Math.PI, p = proj(xc + Math.cos(a) * 0.38, y1, zc + Math.sin(a) * 0.38); ctx.lineTo(p[0], p[1]); }
            ctx.fillStyle = '#1a1a1a'; ctx.fill();
            ring(y1, 0.38); ctx.fillStyle = '#2e2e2e'; ctx.fill();
            ring(y1, 0.19); ctx.fillStyle = '#0c0c0c'; ctx.fill();
        }
    }
    function drawObstacles() {
        for (const o of OBST) {
            const xc = (o.x0 + o.x1) / 2;
            if (o.type === 'car') drawCar(xc, 0, 0, [74, 140, 150], true);
            else drawTires(xc, 0, 3);
        }
    }
    function drawScrapyard() {
        const g = ctx.createLinearGradient(0, 0, 0, CH);
        g.addColorStop(0, '#93bfe0'); g.addColorStop(0.6, '#e6e2d6'); g.addColorStop(1, '#ece6da');
        ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = '#a9b59a'; path([[-140, 0, -90], ...RIDGE, [140, 0, -90]]); ctx.fill();
        ctx.fillStyle = '#b8a27c'; path([[-90, 0, -40], [90, 0, -40], [90, 0, 9], [-90, 0, 9]]); ctx.fill(); // Schotter
        for (const [x, lvl, col] of WRECKS) drawCar(x, -9.5, lvl * 1.05, col, false);
        const zb = -ZW - 1.3, x0 = -XMAX - DECK - 2, x1 = XMAX + DECK + 2, fh = 2.3; // Wellblechzaun
        ctx.fillStyle = '#9ba3a8'; path([[x0, 0, zb], [x1, 0, zb], [x1, fh, zb], [x0, fh, zb]]); ctx.fill();
        ctx.strokeStyle = 'rgba(60,66,70,.35)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = x0; x < x1; x += 0.3) { const p = proj(x, 0, zb), q = proj(x, fh, zb); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(140,70,30,.35)'; // Rostlaufspuren
        for (let x = x0 + 1.7; x < x1; x += 5.3) path([[x, 0.6, zb], [x + 0.5, 0.6, zb], [x + 0.35, fh, zb], [x + 0.15, fh, zb]]), ctx.fill();
        ctx.fillStyle = '#8f8f8a'; path([[x0, 0.002, zb], [x1, 0.002, zb], [x1, 0.002, ZW + 1.2], [x0, 0.002, ZW + 1.2]]); ctx.fill(); // Asphalt
        bannerRow(-XMAX - DECK - 1.6, XMAX + DECK + 1.6, 1.05, 2.0, zb + 0.01, 0, false, BMX_BRANDS);
        drawCrowd(BMX_CROWD, zb + 0.6, 0);
        drawTires(-XMAX - DECK - 0.4, zb + 0.8, 4); drawTires(XMAX + DECK + 0.6, zb + 0.9, 2); // Deko-Stapel am Zaun
    }

    function drawBackground() {
        if (parkId === 'bmx') return drawScrapyard();
        const street = parkId === 'street';
        const g = ctx.createLinearGradient(0, 0, 0, CH);
        if (street) { g.addColorStop(0, '#7fb2dc'); g.addColorStop(0.6, '#e2e6ea'); g.addColorStop(1, '#eceae6'); }
        else { g.addColorStop(0, '#8ec5ea'); g.addColorStop(0.6, '#d7ecf7'); g.addColorStop(1, '#eef6f2'); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
        if (street) {
            for (const hs of HOUSES) {
                ctx.fillStyle = hs.col;
                path([[hs.x0, 0, hs.z], [hs.x1, 0, hs.z], [hs.x1, hs.h, hs.z], [hs.x0, hs.h, hs.z]]); ctx.fill();
                if (!hs.win || hs.row) continue;
                ctx.fillStyle = 'rgba(70,85,100,.35)';
                for (let y = 1.8; y < hs.h - 1.2; y += 2.8) for (let x = hs.x0 + 1; x < hs.x1 - 1.2; x += 2.2) { path([[x, y, hs.z], [x + 1, y, hs.z], [x + 1, y + 1.3, hs.z], [x, y + 1.3, hs.z]]); ctx.fill(); }
            }
            ctx.fillStyle = '#8fa58a'; path([[-110, 0, -46], [110, 0, -46], [110, 0, 9], [-110, 0, 9]]); ctx.fill();
            const zb = -ZW - 1.4; // Rückwand aus Beton, darauf die Banner
            drawBrickWall(-XMAX - DECK - 2, XMAX + DECK + 2, 2.6, zb);
            ctx.fillStyle = '#c4c6c8'; path([[-XMAX - DECK - 2, 0.002, zb], [XMAX + DECK + 2, 0.002, zb], [XMAX + DECK + 2, 0.002, ZW + 1.2], [-XMAX - DECK - 2, 0.002, ZW + 1.2]]); ctx.fill();
            bannerRow(-XMAX - DECK - 1.6, XMAX + DECK + 1.6, 1.0, 2.25, zb + 0.01, 0, false);
            drawCrowd(CROWD, zb + 0.7, 0);
            drawDog(zb + 1.05);
            return;
        }
        ctx.fillStyle = '#9fb7a6';
        path([[-140, 0, -90], ...RIDGE, [140, 0, -90]]); ctx.fill();
        ctx.fillStyle = '#86b06a'; path([[-60, 0, -40], [60, 0, -40], [60, 0, 9], [-60, 0, 9]]); ctx.fill();
        for (const t of TREES) {
            const b = proj(t.x, 0, t.z), tp = proj(t.x, t.h, t.z), w = 1.3 * FOCAL / b[2];
            ctx.fillStyle = t.z < -20 ? '#4f7a5a' : '#3d6849';
            ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(b[0] - w, b[1] - w * 0.15); ctx.lineTo(b[0] + w, b[1] - w * 0.15); ctx.fill();
        }
        ctx.fillStyle = '#b9bdbb'; path([[-14, 0.002, -5], [14, 0.002, -5], [14, 0.002, 4.4], [-14, 0.002, 4.4]]); ctx.fill();
        bannerRow(-XMAX, XMAX, 0.5, 1.55, -4.4, 0, true); // Bannerzaun hinter der Halfpipe
    }

    // Rails (Rohr auf Pfosten) und Ledges (Betonblock mit Stahlkante), hinter der Fahrlinie
    function drawRails() {
        for (const r of RAILS) {
            if (r.type === 'ledge') {
                const zf = r.z + 0.3, zb = r.z - 0.3;
                // Stirnseiten zuerst: die abgewandte verdecken Ober- und Vorderseite (konvexer Block)
                ctx.fillStyle = '#7b7e81';
                for (const x of [r.x0, r.x1]) { path([[x, 0, zb], [x, 0, zf], [x, r.h, zf], [x, r.h, zb]]); ctx.fill(); }
                ctx.fillStyle = '#a3a6a8'; path([[r.x0, r.h, zb], [r.x1, r.h, zb], [r.x1, r.h, zf], [r.x0, r.h, zf]]); ctx.fill();
                ctx.fillStyle = '#8a8d90'; path([[r.x0, 0, zf], [r.x1, 0, zf], [r.x1, r.h, zf], [r.x0, r.h, zf]]); ctx.fill();
                const a = proj(r.x0, r.h, zf), b = proj(r.x1, r.h, zf);
                ctx.strokeStyle = '#4c5257'; ctx.lineWidth = 0.04 * FOCAL / b[2] + 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
                continue;
            }
            ctx.strokeStyle = '#3d4247'; ctx.lineWidth = 0.05 * FOCAL / proj(r.x0, 0, r.z)[2] + 1; ctx.beginPath();
            for (let x = r.x0 + 0.3; x <= r.x1 - 0.29; x += (r.x1 - r.x0 - 0.6) / 2) { const p = proj(x, 0, r.z), q = proj(x, r.h, r.z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
            ctx.stroke();
            const a = proj(r.x0, r.h, r.z), b = proj(r.x1, r.h, r.z);
            ctx.strokeStyle = '#d6dadd'; ctx.lineWidth = 0.06 * FOCAL / b[2] + 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
            ctx.strokeStyle = '#6d7377'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a[0], a[1] + 2); ctx.lineTo(b[0], b[1] + 2); ctx.stroke();
        }
    }

    function drawPipe() {
        for (const sd of [-1, 1]) { // Plattformen mit Geländer
            const x0 = sd * XMAX, x1 = sd * (XMAX + DECK);
            ctx.fillStyle = rgb(park.deck, 0.95); path([[x0, R, -ZW], [x1, R, -ZW], [x1, R, ZW], [x0, R, ZW]]); ctx.fill();
            ctx.strokeStyle = '#6d7377'; ctx.lineWidth = 2;
            const r0 = proj(x0 + sd * 0.3, R + 1, -ZW), r1 = proj(x1, R + 1, -ZW);
            ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]);
            for (let k = 0; k <= 3; k++) { const xx = x0 + sd * 0.3 + (x1 - x0 - sd * 0.3) * k / 3, a = proj(xx, R, -ZW), b = proj(xx, R + 1, -ZW); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
            ctx.stroke();
        }
        const vis = []; // Fahrfläche von hinten nach vorne (Maleralgorithmus)
        for (const q of QUADS) {
            const ex = eye[0] - q.c[0], ey = eye[1] - q.c[1], ez = eye[2] - q.c[2];
            if (q.n[0] * ex + q.n[1] * ey <= 0) continue;
            vis.push({ q, d: ex * ex + ey * ey + ez * ez });
        }
        vis.sort((a, b) => b.d - a.d);
        for (const { q } of vis) { path(q.pts); ctx.fillStyle = q.fill; ctx.strokeStyle = q.fill; ctx.lineWidth = 1; ctx.fill(); ctx.stroke(); }
        for (const sd of [-1, 1]) { // Coping
            const a = proj(sd * XMAX, R, -ZW), b = proj(sd * XMAX, R, ZW);
            ctx.strokeStyle = '#8a9399'; ctx.lineWidth = 0.09 * FOCAL / b[2] + 1;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
    }

    function drawSide() {
        const pts = [[-XMAX - DECK, 0, ZW], [-XMAX - DECK, R, ZW], ...P.map((p) => [p.x, p.y, ZW]), [XMAX + DECK, R, ZW], [XMAX + DECK, 0, ZW]];
        path(pts); ctx.fillStyle = park.side; ctx.fill();
        if (park.graffiti.length) { // Graffiti nur auf der Seitenwand, nicht darüber hinaus
            ctx.save(); path(pts); ctx.clip();
            for (const gr of park.graffiti) graffito(gr, ZW + 0.01);
            ctx.restore();
        }
        ctx.strokeStyle = 'rgba(70,45,20,.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -XMAX - DECK + 1.1; x < XMAX + DECK; x += 1.1) {
            const top = Math.abs(x) >= XMAX ? R : groundY(x); if (top < 0.05) continue;
            const a = proj(x, 0, ZW), b = proj(x, top, ZW); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
        ctx.strokeStyle = park.sideLine; ctx.lineWidth = 2.5; ctx.beginPath();
        pts.slice(1, -1).forEach((p, i) => { const q = proj(p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.stroke();
    }

    // ---------- Fahrer ----------
    function riderBase() {
        if (st.mode === 'ready') return { x: -XMAX - 0.55, y: R, z: 0, pitch: 0 };
        if (st.mode === 'grind' && vehicle === 'bmx') return { x: st.x, y: st.y - 0.27, z: st.z, pitch: st.pitch }; // auf den Pegs
        if (st.mode === 'air' || st.mode === 'grind') return { x: st.x, y: st.y, z: st.z, pitch: st.pitch };
        if (st.mode === 'vert') return { x: st.side * XMAX, y: R + st.h, z: st.z, pitch: st.pitch };
        const p = posAt(st.s); return { x: p.x, y: p.y, z: st.z, pitch: st.pitch };
    }

    function drawRider(b) {
        const sk = vehicle === 'skate', c = st.crouch;
        const fa = st.flipT > 0 ? st.flipT * Math.PI * 2 : 0;
        const lift = st.flipT > 0 ? Math.sin(Math.PI * st.flipT) * 0.28 : 0;
        const hipY = 0.88 - 0.3 * c, kneeY = 0.5 - 0.14 * c;
        let pitch = b.pitch;
        if (st.mode === 'bail') pitch += Math.min(1, st.bailT * 3) * 1.45 * (st.v >= 0 ? -1 : 1);
        const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const X = (p) => {
            const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1];
            return proj(b.x + x * cp - y * sp, b.y + x * sp + y * cp, b.z + z);
        };
        const boardT = (p) => {
            let [x, y, z] = p;
            if (fa) {
                const cf = Math.cos(fa), sf = Math.sin(fa);
                if (sk) { const yy = y - 0.09; y = yy * cf - z * sf + 0.09; z = yy * sf + z * cf; }
                else { const xx = x - 0.36; x = xx * cf + z * sf + 0.36; z = -xx * sf + z * cf; }
            }
            return X([x, y + lift, z]);
        };
        const line = (a, bb, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, w * FOCAL / a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bb[0], bb[1]); ctx.stroke(); };
        const dot = (a, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(1.5, r * FOCAL / a[2]), 0, 7); ctx.fill(); };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (vehicle === 'bmx') return drawBmx(X, line, dot, c);

        const deck = sk ? [[-0.42, 0.09, -0.11], [0.42, 0.09, -0.11], [0.42, 0.09, 0.11], [-0.42, 0.09, 0.11]]
            : [[-0.34, 0.09, -0.07], [0.3, 0.09, -0.07], [0.3, 0.09, 0.07], [-0.34, 0.09, 0.07]];
        const wheels = sk ? [[-0.28, 0.035, -0.1], [-0.28, 0.035, 0.1], [0.28, 0.035, -0.1], [0.28, 0.035, 0.1]] : [[-0.32, 0.055, 0], [0.38, 0.055, 0]];
        for (const w of wheels) dot(boardT(w), sk ? 0.035 : 0.055, sk ? '#f2efe6' : '#333');
        const dp = deck.map(boardT);
        ctx.beginPath(); dp.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
        ctx.fillStyle = sk ? '#3b2a1a' : '#4c5359'; ctx.fill(); ctx.strokeStyle = sk ? '#c0392b' : '#222'; ctx.lineWidth = 1.5; ctx.stroke();

        const skin = '#f0c8a0', shirt = '#2f6b45', pants = '#2b3440', helmet = '#d33b2f';
        const footUp = lift + (st.flipT > 0 ? 0.1 * Math.sin(Math.PI * st.flipT) : 0);
        if (sk) {
            const fL = X([-0.2, 0.1 + footUp, 0]), fR = X([0.2, 0.1 + footUp, 0]);
            const kL = X([-0.17, kneeY + footUp * 0.6, 0.13]), kR = X([0.17, kneeY + footUp * 0.6, 0.13]);
            const hip = X([0, hipY, 0]), sh = X([0, hipY + 0.5, 0.05]);
            const sL = X([-0.17, hipY + 0.48, 0.05]), sR = X([0.17, hipY + 0.48, 0.05]);
            const hL = X([-0.5, hipY + 0.28, 0.12]);
            const hR = st.grab ? X([0.05, 0.09 + lift, 0.13]) : X([0.5, hipY + 0.28, 0.12]);
            const head = X([0, hipY + 0.7, 0.05]);
            line(fL, kL, pants, 0.11); line(kL, hip, pants, 0.12); line(fR, kR, pants, 0.11); line(kR, hip, pants, 0.12);
            line(hip, sh, shirt, 0.2);
            line(sL, hL, shirt, 0.08); line(sR, hR, shirt, 0.08); dot(hL, 0.045, skin); dot(hR, 0.045, skin);
            dot(head, 0.12, skin); dot(X([0, hipY + 0.75, 0.04]), 0.105, helmet);
        } else {
            const colB = X([0.36, 0.09 + lift, 0]), colT = X([0.36, 0.98, 0]);
            const gL = X([0.36, 0.98, -0.26]), gR = X([0.36, 0.98, 0.26]);
            line(colB, colT, '#9aa3a8', 0.04); line(gL, gR, '#222', 0.035);
            const fA = X([-0.2, 0.1 + footUp, 0.05]), fB = X([0.04, 0.1 + footUp, -0.05]);
            const kA = X([-0.06, kneeY + footUp * 0.6, 0.08]), kB = X([0.12, kneeY + footUp * 0.6, -0.08]);
            const hip = X([-0.14, hipY, 0]), sh = X([0.02, hipY + 0.48, 0]);
            const sL = X([0.02, hipY + 0.46, -0.17]), sR = X([0.02, hipY + 0.46, 0.17]);
            const head = X([0.07, hipY + 0.68, 0]);
            line(fA, kA, pants, 0.11); line(kA, hip, pants, 0.12); line(fB, kB, pants, 0.11); line(kB, hip, pants, 0.12);
            line(hip, sh, shirt, 0.2);
            line(sL, gL, shirt, 0.08); line(sR, gR, shirt, 0.08);
            dot(head, 0.12, skin); dot(X([0.06, hipY + 0.73, 0]), 0.105, helmet);
        }
    }

    // BMX (20 Zoll) mit stehendem Fahrer. Vorne ist +x. Tabletop (↓ in der Luft): Rad und Fahrer kippen zur Seite,
    // Barspin (↑): der Lenker dreht sich einmal um den Vorbau, die Hände lassen kurz los
    let tabA = 0;
    function drawBmx(X, line, dot, c) {
        tabA += ((st.grab && (st.mode === 'air' || st.mode === 'vert') ? 1.05 : 0) - tabA) * 0.25;
        const ct = Math.cos(tabA), stb = Math.sin(tabA);
        const B = (p) => { const yy = p[1] - 0.3; return X([p[0], 0.3 + yy * ct - p[2] * stb, yy * stb + p[2] * ct]); };
        const bs = st.flipT > 0 ? st.flipT * Math.PI * 2 : 0;
        const RW = 0.27;
        for (const cx of [-0.5, 0.5]) { // Räder
            const pts = []; for (let k = 0; k <= 22; k++) { const a = k / 22 * Math.PI * 2; pts.push(B([cx + Math.cos(a) * RW, RW + Math.sin(a) * RW, 0])); }
            ctx.strokeStyle = 'rgba(190,195,200,.75)'; ctx.lineWidth = 1; ctx.beginPath(); // Speichen
            const hub = B([cx, RW, 0]); for (let k = 0; k < 22; k += 3) { ctx.moveTo(hub[0], hub[1]); ctx.lineTo(pts[k][0], pts[k][1]); }
            ctx.stroke();
            ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = Math.max(2, 0.055 * FOCAL / hub[2]); ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
            line(B([cx, RW, -0.13]), B([cx, RW, 0.13]), '#b8bec2', 0.045); // Pegs
        }
        const frame = '#1d9bd1', RA = [-0.5, RW, 0], BB = [-0.04, 0.3, 0], ST = [-0.2, 0.66, 0], HT = [0.36, 0.7, 0], HB = [0.39, 0.58, 0], FA = [0.5, RW, 0];
        line(B(RA), B(BB), frame, 0.04); line(B(RA), B(ST), frame, 0.035);
        line(B(BB), B(ST), frame, 0.05); line(B(BB), B(HB), frame, 0.055); line(B(ST), B(HT), frame, 0.05);
        line(B(HB), B(FA), '#2b2b2b', 0.045); line(B(HB), B(HT), frame, 0.06);
        line(B(ST), B([-0.23, 0.74, 0]), '#2b2b2b', 0.03); line(B([-0.36, 0.76, 0]), B([-0.1, 0.78, 0]), '#1b1b1b', 0.06); // Sattel
        dot(B(BB), 0.07, '#555');
        const ST2 = [0.33, 0.9, 0]; line(B(HT), B(ST2), '#2b2b2b', 0.04); // Vorbau
        const bx = Math.sin(bs) * 0.3, bz = Math.cos(bs) * 0.3;
        const gL = [ST2[0] - bx, 0.96, -bz], gR = [ST2[0] + bx, 0.96, bz];
        line(B([ST2[0] - bx * 0.5, 0.9, -bz * 0.5]), B([ST2[0] + bx * 0.5, 0.9, bz * 0.5]), '#2b2b2b', 0.03);
        line(B(gL), B(gR), '#2b2b2b', 0.035);
        // Fahrer: steht in den Pedalen, beim Pumpen tiefer
        const skin = '#f0c8a0', shirt = '#2f6b45', pants = '#2b3440', helmet = '#d33b2f';
        const hipY = 1.0 - 0.26 * c, shY = 1.42 - 0.3 * c;
        const fA = B([0.1, 0.33, 0.1]), fB = B([-0.18, 0.27, -0.1]);
        const kA = B([0.2, 0.68 - 0.1 * c, 0.12]), kB = B([0.06, 0.64 - 0.1 * c, -0.12]);
        const hip = B([-0.12, hipY, 0]), sh = B([0.1, shY, 0]);
        const sL = B([0.1, shY - 0.02, -0.17]), sR = B([0.1, shY - 0.02, 0.17]);
        const free = bs > 0, hL = free ? B([0.2, shY - 0.1, -0.32]) : B(gL), hR = free ? B([0.2, shY - 0.1, 0.32]) : B(gR);
        const head = B([0.18, shY + 0.18, 0]);
        line(fA, kA, pants, 0.11); line(kA, hip, pants, 0.12); line(fB, kB, pants, 0.11); line(kB, hip, pants, 0.12);
        line(hip, sh, shirt, 0.2);
        line(sL, hL, shirt, 0.08); line(sR, hR, shirt, 0.08); dot(hL, 0.045, skin); dot(hR, 0.045, skin);
        dot(head, 0.13, helmet); dot(B([0.27, shY + 0.16, 0]), 0.055, skin); // Integralhelm mit Gesichtsöffnung
    }

    function drawShadow(b) {
        if (st.mode === 'vert' || st.mode === 'ready') return;
        const gx = clamp(b.x, -XMAX + 0.3, XMAX - 0.3), gy = groundY(gx);
        const p = proj(gx, gy + 0.01, b.z), r = 0.5 * FOCAL / p[2];
        const hgt = Math.max(0, b.y - gy);
        ctx.fillStyle = `rgba(0,0,0,${0.22 / (1 + hgt * 0.6)})`;
        ctx.beginPath(); ctx.ellipse(p[0], p[1], r, r * 0.28, 0, 0, 7); ctx.fill();
    }

    function txt(s, x, y, size, align, col) {
        ctx.font = `700 ${size}px system-ui,sans-serif`; ctx.textAlign = align || 'left';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(s, x, y);
        ctx.fillStyle = col || '#1d2a22'; ctx.fillText(s, x, y);
    }

    function drawHud() {
        txt(`${TXT.points} ${st.score}`, 18, 34, 22);
        txt(freeRide ? TXT.free : `${TXT.time} ${Math.ceil(st.time)} s`, 18, 62, 18);
        if (st.combo > 1) txt(`${TXT.combo} × ${st.combo}`, 18, 88, 18, 'left', '#c0392b');
        const v = st.mode === 'ground' || st.mode === 'grind' ? Math.abs(st.v) : st.mode === 'air' ? Math.hypot(st.vx, st.vy) : Math.abs(st.vy);
        if (st.mode === 'grind') { // Balance: Strich in der Mitte halten, mit ← → gegensteuern
            const bx = CW / 2, by = CH - 54;
            txt(st.gName, bx, by - 12, 18, 'center', '#1d2a22');
            ctx.fillStyle = 'rgba(29,42,34,.2)'; ctx.fillRect(bx - 110, by, 220, 10);
            ctx.fillStyle = 'rgba(47,107,69,.35)'; ctx.fillRect(bx - 35, by, 70, 10);
            ctx.fillStyle = Math.abs(st.bal) > 0.65 ? '#c0392b' : '#1d2a22'; ctx.fillRect(bx + clamp(st.bal, -1, 1) * 110 - 3, by - 4, 6, 18);
        }
        txt(Math.round(v * 3.6) + ' km/h', CW - 18, 34, 20, 'right');
        // Pump-Ladung: kleiner Balken unter dem Tempo
        if (st.mode === 'ground' || st.charge > 0) {
            ctx.fillStyle = 'rgba(29,42,34,.18)'; ctx.fillRect(CW - 118, 44, 100, 6);
            ctx.fillStyle = '#2f6b45'; ctx.fillRect(CW - 118, 44, 100 * st.charge, 6);
        }
        txt(`${TXT.record} ${best}`, CW - 18, 72, 16, 'right', '#4a5a50');
        if (st.pumpFlash > 0) { ctx.globalAlpha = Math.min(1, st.pumpFlash * 2); txt(TXT.pump, CW - 18, 98, 18, 'right', '#2f6b45'); ctx.globalAlpha = 1; }
        pops.forEach((p, i) => {
            ctx.globalAlpha = clamp(1.6 - p.t * 0.75, 0, 1);
            const y = 120 + (pops.length - 1 - i) * 54 - p.t * 12;
            txt(p.text, CW / 2, y, 28, 'center', p.text === TXT.bail ? '#c0392b' : '#1d2a22');
            if (p.sub) txt(p.sub, CW / 2, y + 24, 18, 'center', '#2f6b45');
            ctx.globalAlpha = 1;
        });
        const elapsed = st.tRun || 0;
        if (parkId === 'bmx') { if (st.cars < 2 && st.mode === 'ground' && elapsed > 1) txt(TXT.hintBmx, CW / 2, CH - 24, 18, 'center', '#1d2a22'); }
        else if (!hintDone && st.mode === 'ground' && elapsed > 1.5) txt(TXT.hint, CW / 2, CH - 24, 18, 'center', '#1d2a22');
        else if (parkId === 'street' && !st.grinds && st.mode === 'ground' && elapsed > 6) txt(TXT.hintStreet, CW / 2, CH - 24, 18, 'center', '#1d2a22');
        if (st.mode === 'ready' || st.mode === 'over') {
            ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(CW / 2 - 260, CH / 2 - 70, 520, 130);
            if (st.mode === 'ready') {
                txt(title(), CW / 2, CH / 2 - 26, 30, 'center');
                txt(TXT.start, CW / 2, CH / 2 + 10, 20, 'center', '#2f6b45');
                txt(freeRide ? TXT.subFree : TXT.sub, CW / 2, CH / 2 + 40, 16, 'center', '#4a5a50');
            } else {
                txt(`${TXT.over}: ${st.score} ${TXT.points}`, CW / 2, CH / 2 - 22, 28, 'center');
                txt(st.newBest ? TXT.newRecord : `${TXT.record}: ${best}`, CW / 2, CH / 2 + 12, 20, 'center', st.newBest ? '#c0392b' : '#4a5a50');
                txt(TXT.again, CW / 2, CH / 2 + 42, 16, 'center', '#2f6b45');
            }
        }
    }

    function draw() {
        const b = riderBase();
        setCam(camX, camY);
        drawBackground();
        drawPipe();
        drawRails();
        drawObstacles();
        if (parkId === 'pipe') drawCrowd(DECK_CROWD, 0, R);
        drawShadow(b);
        drawRider(b);
        drawSide();
        if (parkId === 'pipe') drawBike(-8.75, ZW + 0.3);
        drawHud();
    }

    function camStep(dt) {
        const b = riderBase(), k = Math.min(1, dt * 4);
        camX += (b.x * 0.62 - camX) * k;
        camY += (Math.max(0, b.y - 2.6) * 0.55 - camY) * k;
    }

    // ---------- Eingabe ----------
    function press(k, down) {
        if (k === 'jump' || k === 'up') {
            if (!down) return;
            if (st.mode === 'ready' || st.mode === 'over') { if (k === 'jump') start(); return; }
            if (k === 'jump') jumpQ = true; else flipQ = true;
            return;
        }
        if (k in keys) keys[k] = down;
    }
    const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up', Space: 'jump' };
    document.addEventListener('keydown', (e) => { const k = KEYMAP[e.code]; if (!k) return; e.preventDefault(); if (!e.repeat) press(k, true); });
    document.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) press(k, false); });
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); if (cv.focus) cv.focus(); press('jump', true); });

    function fit() {
        const d = Math.min(2, window.devicePixelRatio || 1);
        cv.width = CW * d; cv.height = CH * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    let last = 0;
    function frame(now) {
        const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
        let t = dt; while (t > 0) { const h = Math.min(1 / 120, t); update(h); t -= h; }
        camStep(dt);
        draw();
        requestAnimationFrame(frame);
    }
    buildPark('pipe');
    loadBest();
    fit();
    window.addEventListener('resize', fit);
    requestAnimationFrame(frame);

    window.Halfpipe = {
        press,
        // 'skate' | 'scooter' | 'bmx'. Im BMX-Park bleibt es beim BMX, die Wahl gilt dann ab dem nächsten Park
        setVehicle(v) { chosen = ['scooter', 'bmx'].includes(v) ? v : 'skate'; vehicle = park.only || chosen; },
        get vehicle() { return vehicle; },
        get only() { return park.only || null; },
        // Parkwechsel beendet die laufende Session
        setPark(id) { buildPark(id); vehicle = park.only || chosen; loadBest(); reset(); camX = camY = 0; announce(title()); },
        get park() { return parkId; },
        // true: Free Ride ohne Zeit (zählt nicht für den Rekord). Beendet die laufende Session
        setFreeRide(on) { freeRide = !!on; reset(); announce(title()); },
        get freeRide() { return freeRide; },
        T: { keys, get state() { return st; }, start, update, camStep, draw, groundY, TH, segAt, posAt,
            get rails() { return RAILS; }, get obst() { return OBST; }, get lips() { return LIPS; },
            get consts() { return { R, VMAX, G, XMAX, KA, KB, KH, W, POP: POP() }; } },
    };
})();
