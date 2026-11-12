// Skateboard Halfpipe: kleines 3D-Spiel auf Canvas, ohne Bibliotheken (eigene Perspektiv-Projektion).
// Skateboard oder Stunt-Scooter in einer Halfpipe mit Funbox in der Mitte. 60 Sekunden, so viele Tricks wie möglich.
// Physik in Metern: Der Fahrer bewegt sich entlang des Profils (Bogenlänge s), in der Luft ballistisch (Ollie, z. B.
// über die Funbox) oder senkrecht über der Kante (Coping). Über die Funbox rollt man, springen nur mit Ollie.
// Schwung holt man durch Pumpen: beim Herunterfahren ↓ halten (Hocke), unten im Bogen loslassen (strecken).
// Wer ↓ dauerhaft hält, wird bergauf langsamer.
// Erwartet ein <canvas id="halfpipe"> (optional mit data-texts) und ein Element #halfpipe-status (aria-live).
// window.Halfpipe.setVehicle('skate'|'scooter'), window.Halfpipe.press(k, down) für Touch-Knöpfe.
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
    }, JSON.parse((cv.dataset && cv.dataset.texts) || '{}'));

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

    // ---------- Geometrie (Meter) ----------
    const G = 9.81, R = 3.2, W = 6, XMAX = W + R, KA = 1.0, KB = 2.6, KH = 0.8, ZW = 3.2, DECK = 2.2;
    // Fahrgefühl
    const VMAX = 11;              // m/s (ca. 40 km/h): Air über der Kante dann knapp 3 m
    const FRIC_A = 0.12, FRIC_B = 0.003; // Rollreibung + Luftwiderstand (m/s²)
    const PUMP = 1.3;             // Schub beim Loslassen mit voller Ladung und gutem Timing (m/s)
    const PUMP_LATE = 0.3;        // s nach dem Ende der Abfahrt, bis der Schub auf 30 % abgefallen ist
    const CHARGE_RATE = 2.2;      // Ladung pro Sekunde in der Hocke beim Herunterfahren (× Steilheit)
    const CROUCH_DRAG = 0.9;      // Hocke bergauf: so viel langsamer (m/s² × Steilheit)
    const SPIN_RATE = 7;          // rad/s (ca. 400°/s)
    const FLIP_TIME = 0.42;       // s für einen Kickflip/Tailwhip
    const SESSION = 60;

    function groundY(x) {
        const ax = Math.abs(x);
        if (ax >= XMAX) return R;
        if (ax > W) { const d = ax - W; return R - Math.sqrt(Math.max(0, R * R - d * d)); }
        if (ax <= KA) return KH;
        if (ax <= KB) return KH * (KB - ax) / (KB - KA);
        return 0;
    }
    const P = [];
    for (let a = 90; a > 0; a -= 3) { const r = a * Math.PI / 180; P.push({ x: -W - R * Math.sin(r), y: R - R * Math.cos(r) }); }
    const KEYX = [-W, -KB, -KA, KA, KB, W];
    for (let i = 0; i < KEYX.length - 1; i++) {
        const x0 = KEYX[i], x1 = KEYX[i + 1], n = Math.max(1, Math.round((x1 - x0) / 0.5));
        for (let j = 0; j < n; j++) { const x = x0 + (x1 - x0) * j / n; P.push({ x, y: groundY(x) }); }
    }
    for (let a = 0; a <= 90; a += 3) { const r = a * Math.PI / 180; P.push({ x: W + R * Math.sin(r), y: R - R * Math.cos(r) }); }
    const NS = P.length - 1, SS = [0], TH = [], LEN = [];
    for (let i = 0; i < NS; i++) {
        const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y, l = Math.hypot(dx, dy);
        LEN.push(l); TH.push(Math.atan2(dy, dx)); SS.push(SS[i] + l);
    }
    const S_END = SS[NS];
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
    let jumpQ = false, flipQ = false, vehicle = 'skate', hintDone = false;
    const BEST_KEY = 'halfpipe-best';
    let best = 0;
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* ohne Speicher eben ohne Rekord */ }
    let st = {};
    const pops = [];
    function reset() {
        st = { mode: 'ready', s: 0.02, v: 0, x: 0, y: 0, vx: 0, vy: 0, side: -1, h: 0, yaw: 0, yaw0: 0,
            flipT: 0, flips: 0, grab: false, grabT: 0, pitch: 0, tA: 0, T: 1, maxH: 0, crouch: 0, bailT: 0,
            charge: 0, sinceDown: 9, prevDown: false, pumpFlash: 0, pumps: 0,
            score: 0, combo: 0, time: SESSION, newBest: false, airs: 0, bails: 0, maxAir: 0 };
        pops.length = 0;
    }
    reset();
    function start() { reset(); st.mode = 'ground'; st.pitch = TH[0]; announce(TXT.title); }
    function pop(text, sub) { pops.push({ text, sub: sub || '', t: 0 }); if (pops.length > 3) pops.shift(); }
    function announce(s) { if (status) status.textContent = s; }
    function takeoff() { st.yaw0 = st.yaw; st.flipT = 0; st.flips = 0; st.grab = false; st.grabT = 0; st.tA = 0; st.maxH = 0; st.charge = 0; }
    function toVert(side, vy) { st.mode = 'vert'; st.side = side; st.h = 0; st.vy = vy; st.tA = 0; st.T = 2 * vy / G; }
    function finish() {
        st.mode = 'over';
        if (st.score > best) { best = st.score; st.newBest = st.score > 0; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* egal */ } }
        announce(`${TXT.over}: ${st.score} ${TXT.points}. ${st.newBest ? TXT.newRecord : TXT.record + ': ' + best + '.'} ${TXT.again}`);
    }
    function bail() { st.mode = 'bail'; st.bailT = 0; st.combo = 0; st.grab = false; st.bails++; pop(TXT.bail, TXT.bailSub); announce(TXT.bail); }

    // Landung: Drehung muss in 180°-Schritten stehen (±40°), Flip fertig sein
    function land() {
        const spin = st.yaw - st.yaw0, halfs = Math.round(spin / Math.PI), err = Math.abs(spin - halfs * Math.PI);
        if (err > 0.7 || (st.flipT > 0 && st.flipT < 0.8)) { bail(); return; }
        if (st.flipT >= 0.8) st.flips++;
        st.flipT = 0; st.yaw = st.yaw0 + halfs * Math.PI; st.grab = false;
        if (st.tA < 0.28) return;
        const coping = st.mode === 'ground' && (st.s < 0.01 || st.s > S_END - 0.01);
        st.airs++; st.maxAir = Math.max(st.maxAir, st.maxH);
        const parts = []; let pts = 0;
        const flipName = vehicle === 'skate' ? TXT.flip : TXT.whip;
        if (st.flips) { parts.push((st.flips === 2 ? TXT.double : st.flips > 2 ? st.flips + '× ' : '') + flipName); pts += Math.round(300 * st.flips * (st.flips > 1 ? 1.3 : 1)); }
        const deg = Math.abs(halfs) * 180;
        if (deg) { parts.push(String(deg)); pts += ({ 180: 100, 360: 250, 540: 450, 720: 700 })[deg] || Math.round(deg * 1.1); }
        if (st.grabT > 0.15) { parts.push(vehicle === 'skate' ? TXT.grab : TXT.tuck); pts += Math.round(st.grabT * 220); }
        if (!pts) { if (!coping && st.tA < 0.5) return; parts.push(TXT.air); pts = 40; } else st.combo = Math.min(5, st.combo + 1);
        pts = Math.round(pts + st.maxH * 45);
        const mult = Math.max(1, st.combo);
        st.score += pts * mult;
        const label = parts.join(' + ');
        pop(label, pts + (mult > 1 ? ' × ' + mult : ''));
        announce(`${label}: ${pts * mult}`);
    }

    // ---------- Physik ----------
    function update(dt) {
        for (const p of pops) p.t += dt;
        while (pops.length && pops[0].t > 2.2) pops.shift();
        st.pumpFlash = Math.max(0, st.pumpFlash - dt);
        if (st.mode === 'ready' || st.mode === 'over') return;
        st.time = Math.max(0, st.time - dt);
        if (st.mode === 'bail') {
            st.bailT += dt;
            if (st.bailT > 1.4) {
                if (st.time <= 0) return finish();
                Object.assign(st, { mode: 'ground', s: 0.02, v: 0, yaw: 0, flipT: 0, pitch: TH[0], bailT: 0, charge: 0 });
            }
            return;
        }
        const inAir = st.mode !== 'ground';
        st.crouch += (((keys.down || (inAir && st.grab)) ? 1 : 0) - st.crouch) * Math.min(1, dt * 10);
        if (st.mode === 'ground') groundStep(dt); else airStep(dt);
        if (st.mode === 'ground' && st.time <= 0) finish();
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
            if (keys.left && st.v > -6) st.v -= 3.5 * dt;
            if (keys.right && st.v < 6) st.v += 3.5 * dt;
        }
        st.v = clamp(st.v, -VMAX, VMAX);
        const s0 = st.s; st.s += st.v * dt;
        if (st.s >= S_END) { if (st.v > 1.2) { takeoff(); return toVert(1, st.v); } st.s = S_END - 1e-3; st.v = -Math.abs(st.v) * 0.5; }
        else if (st.s <= 0) { if (st.v < -1.2) { takeoff(); return toVert(-1, -st.v); } st.s = 1e-3; st.v = Math.abs(st.v) * 0.5; }
        if (jumpQ) { // Ollie
            jumpQ = false;
            const p = posAt(st.s); takeoff(); st.mode = 'air';
            st.x = p.x; st.y = p.y + 0.02;
            st.vx = st.v * Math.cos(th) - 3.6 * Math.sin(th); st.vy = st.v * Math.sin(th) + 3.6 * Math.cos(th);
            return;
        }
        th = TH[segAt(st.s)];
        st.pitch += angDiff(th, st.pitch) * Math.min(1, dt * 16);
    }

    function airStep(dt) {
        jumpQ = false;
        st.prevDown = false;
        st.tA += dt;
        if (keys.left) st.yaw += SPIN_RATE * dt;
        if (keys.right) st.yaw -= SPIN_RATE * dt;
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
        st.vy -= G * dt; st.x += st.vx * dt; st.y += st.vy * dt;
        const gy = groundY(st.x);
        st.maxH = Math.max(st.maxH, st.y - gy);
        st.pitch -= st.pitch * Math.min(1, dt * 2.5);
        if (Math.abs(st.x) >= XMAX - 0.02) {
            const side = Math.sign(st.x); st.x = side * (XMAX - 0.02);
            if (st.y >= R) { st.mode = 'vert'; st.side = side; st.h = st.y - R; st.T = st.tA + 2 * Math.max(0.3, st.vy) / G; }
            else st.vx = -st.vx * 0.3;
        } else if (st.vy < 0 && st.y <= gy) {
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

    const QUADS = [];
    const C_WOOD = [222, 196, 150], C_FLAT = [200, 202, 198], C_BOX = [176, 182, 190];
    for (let i = 0; i < NS; i++) {
        const a = P[i], b = P[i + 1], n = [-Math.sin(TH[i]), Math.cos(TH[i]), 0];
        const midX = (a.x + b.x) / 2, ax = Math.abs(midX);
        const col = ax > W ? C_WOOD : ax < KB ? C_BOX : C_FLAT;
        const sh = 0.66 + 0.34 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1]);
        for (let j = 0; j < 4; j++) {
            const z0 = -ZW + j * ZW / 2, z1 = z0 + ZW / 2;
            QUADS.push({ pts: [[a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], [a.x, a.y, z1]], c: [midX, (a.y + b.y) / 2, (z0 + z1) / 2], n,
                fill: rgb(col, sh * (i % 2 ? 1 : 0.97)) });
        }
    }
    // Hintergrund: Harzkamm mit Brocken und Tannen
    const RIDGE = [];
    for (let x = -140; x <= 140; x += 7) RIDGE.push([x, 9 + 5 * Math.sin(x * 0.045) + 3 * Math.sin(x * 0.13 + 1) + (Math.abs(x - 30) < 18 ? 9 * Math.cos((x - 30) / 18 * Math.PI / 2) : 0), -90]);
    const TREES = [];
    {
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 46; i++) TREES.push({ x: -40 + rnd() * 80, z: -12 - rnd() * 16, h: 4 + rnd() * 4 });
        TREES.sort((a, b) => a.z - b.z);
    }

    function drawBackground() {
        const g = ctx.createLinearGradient(0, 0, 0, CH);
        g.addColorStop(0, '#8ec5ea'); g.addColorStop(0.6, '#d7ecf7'); g.addColorStop(1, '#eef6f2');
        ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = '#9fb7a6';
        path([[-140, 0, -90], ...RIDGE, [140, 0, -90]]); ctx.fill();
        ctx.fillStyle = '#86b06a'; path([[-60, 0, -40], [60, 0, -40], [60, 0, 9], [-60, 0, 9]]); ctx.fill();
        for (const t of TREES) {
            const b = proj(t.x, 0, t.z), tp = proj(t.x, t.h, t.z), w = 1.3 * FOCAL / b[2];
            ctx.fillStyle = t.z < -20 ? '#4f7a5a' : '#3d6849';
            ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(b[0] - w, b[1] - w * 0.15); ctx.lineTo(b[0] + w, b[1] - w * 0.15); ctx.fill();
        }
        ctx.fillStyle = '#b9bdbb'; path([[-14, 0.002, -5], [14, 0.002, -5], [14, 0.002, 4.4], [-14, 0.002, 4.4]]); ctx.fill();
    }

    function drawPipe() {
        for (const sd of [-1, 1]) { // Plattformen mit Geländer
            const x0 = sd * XMAX, x1 = sd * (XMAX + DECK);
            ctx.fillStyle = rgb(C_WOOD, 0.95); path([[x0, R, -ZW], [x1, R, -ZW], [x1, R, ZW], [x0, R, ZW]]); ctx.fill();
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
        path(pts); ctx.fillStyle = '#a8875a'; ctx.fill();
        ctx.strokeStyle = 'rgba(70,45,20,.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -XMAX - DECK + 1.1; x < XMAX + DECK; x += 1.1) {
            const top = Math.abs(x) >= XMAX ? R : groundY(x); if (top < 0.05) continue;
            const a = proj(x, 0, ZW), b = proj(x, top, ZW); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
        ctx.strokeStyle = '#7a5a33'; ctx.lineWidth = 2.5; ctx.beginPath();
        pts.slice(1, -1).forEach((p, i) => { const q = proj(p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.stroke();
    }

    // ---------- Fahrer ----------
    function riderBase() {
        if (st.mode === 'ready') return { x: -XMAX - 0.55, y: R, pitch: 0 };
        if (st.mode === 'air') return { x: st.x, y: st.y, pitch: st.pitch };
        if (st.mode === 'vert') return { x: st.side * XMAX, y: R + st.h, pitch: st.pitch };
        const p = posAt(st.s); return { x: p.x, y: p.y, pitch: st.pitch };
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
            return proj(b.x + x * cp - y * sp, b.y + x * sp + y * cp, z);
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

    function drawShadow(b) {
        if (st.mode === 'vert' || st.mode === 'ready') return;
        const gx = clamp(b.x, -XMAX + 0.3, XMAX - 0.3), gy = groundY(gx);
        const p = proj(gx, gy + 0.01, 0), r = 0.5 * FOCAL / p[2];
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
        txt(`${TXT.time} ${Math.ceil(st.time)} s`, 18, 62, 18);
        if (st.combo > 1) txt(`${TXT.combo} × ${st.combo}`, 18, 88, 18, 'left', '#c0392b');
        const v = st.mode === 'ground' ? Math.abs(st.v) : st.mode === 'air' ? Math.hypot(st.vx, st.vy) : Math.abs(st.vy);
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
        if (!hintDone && st.mode === 'ground' && st.time < SESSION - 1.5) txt(TXT.hint, CW / 2, CH - 24, 18, 'center', '#1d2a22');
        if (st.mode === 'ready' || st.mode === 'over') {
            ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(CW / 2 - 260, CH / 2 - 70, 520, 130);
            if (st.mode === 'ready') {
                txt(TXT.title, CW / 2, CH / 2 - 26, 30, 'center');
                txt(TXT.start, CW / 2, CH / 2 + 10, 20, 'center', '#2f6b45');
                txt(TXT.sub, CW / 2, CH / 2 + 40, 16, 'center', '#4a5a50');
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
        drawShadow(b);
        drawRider(b);
        drawSide();
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
    fit();
    window.addEventListener('resize', fit);
    requestAnimationFrame(frame);

    window.Halfpipe = {
        press,
        setVehicle(v) { vehicle = v === 'scooter' ? 'scooter' : 'skate'; },
        T: { keys, get state() { return st; }, start, update, camStep, draw, groundY, TH, segAt, consts: { R, VMAX, G } },
    };
})();
