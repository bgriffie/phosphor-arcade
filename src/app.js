/* Phosphor Arcade: Snake, 2048, Mines, Blocks, Pin Rescue. */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DEFAULTS = { snakeSpeed: 'normal', snakeWrap: false, minefield: 'easy', ghost: true };
  Object.assign(PH.store.defaults, DEFAULTS);   // so games can read settings before PH.init

  /* ---------- Tool data: best scores + saved 2048 game ---------- */
  const DKEY = 'phosphor-arcade:data';
  const blankBest = () => ({ snake: 0, g2048: 0, blocks: 0, pins: 0, mines: { easy: null, normal: null, hard: null } });
  const blank = () => ({ best: blankBest(), g2048: null, pins: 0 });
  let data = (() => {
    try {
      const d = JSON.parse(localStorage.getItem(DKEY));
      if (d && d.best) {
        const b = blankBest();
        return { g2048: d.g2048 || null, pins: d.pins || 0, best: { ...b, ...d.best, mines: { ...b.mines, ...(d.best.mines || {}) } } };
      }
    } catch {}
    return blank();
  })();
  const save = () => { try { localStorage.setItem(DKEY, JSON.stringify(data)); } catch {} };

  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const fmtTime = s => s == null ? '—' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  const tok = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;
  const C = {
    bg: tok('--bg', '#030703'), s1: tok('--surface-1', '#08110A'), line: tok('--line', '#1F3D26'),
    text: tok('--text', '#C9F5D3'), dim: tok('--text-dim', '#86C295'), accent: tok('--accent', '#39FF6A'),
    accentDim: tok('--accent-dim', '#1E9E42'), amber: tok('--amber', '#FFB13B'), red: tok('--red', '#FF5C5C'), cyan: tok('--cyan', '#5CE1FF'),
  };

  /* Canvas sized in CSS px, drawn at device resolution */
  function sizeCanvas(cv, w, h) {
    const r = dpr();
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0); return ctx;
  }

  /* Keep game touches away from the page (no scrolling, no edge-swipe back mid-game) */
  function ownTouches(el) {
    el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    el.addEventListener('touchend', e => e.stopPropagation(), { passive: true });
    el.addEventListener('touchmove', e => { e.stopPropagation(); if (!e.target.closest('.overlay')) e.preventDefault(); }, { passive: false });
  }
  function onSwipe(el, fn, tap) {
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 === null || e.target.closest('.overlay')) { x0 = null; return; }
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) { tap && tap(); return; }
      fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
  }

  /* Overlay card over a board: title, lines, one primary button, optional ghost button */
  function overlay(el, { title, lines = [], best = false, primary, onPrimary, secondary, onSecondary }) {
    el.textContent = '';
    const h = document.createElement('h2'); h.textContent = title; el.appendChild(h);
    lines.forEach(t => { const p = document.createElement('p'); p.textContent = t; el.appendChild(p); });
    if (best) { const p = document.createElement('p'); p.className = 'new-best'; p.textContent = '▲ New best'; el.appendChild(p); }
    const b = document.createElement('button'); b.className = 'btn btn-primary'; b.textContent = primary; b.onclick = onPrimary; el.appendChild(b);
    if (secondary) { const s = document.createElement('button'); s.className = 'btn btn-ghost'; s.textContent = secondary; s.onclick = onSecondary; el.appendChild(s); }
    el.hidden = false;
  }

  let active = null;   // the game on screen, if any
  const syncKeys = () => {
    const b = $('.page-keys [data-act="pause"]');
    if (b) { const p = !!(active && active.paused); b.textContent = p ? '▸' : 'II'; b.setAttribute('aria-label', p ? 'Resume' : 'Pause'); }
  };

  /* ======================================================================
     SNAKE
     ====================================================================== */
  const snake = (() => {
    const wrap = $('#snake-wrap'), box = $('#snake-box'), cv = $('#snake-cv'), ov = $('#snake-ov');
    const view = wrap.closest('.view'), COLS = 15, SPEED = { slow: 170, normal: 120, fast: 82 };
    let ctx, rows = 20, cell = 20, body, dir, queue, food, score = 0, state = 'ready', timer = null, dead = false, newBest = false;

    function reset() {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (w > 0 && h > 0) rows = Math.max(15, Math.min(40, Math.floor(h / Math.max(1, Math.floor(w / COLS)))));
      const mx = Math.floor(COLS / 2) - 1, my = Math.floor(rows / 2);
      body = [{ x: mx, y: my }, { x: mx - 1, y: my }, { x: mx - 2, y: my }];
      dir = { x: 1, y: 0 }; queue = []; score = 0; dead = false; newBest = false;
      placeFood(); stats(); fit();
    }
    function placeFood() {
      const free = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < COLS; x++) if (!body.some(p => p.x === x && p.y === y)) free.push({ x, y });
      food = free[Math.random() * free.length | 0] || null;
    }
    function stats() { $('#snake-score').textContent = fmt(score); $('#snake-best').textContent = fmt(data.best.snake); }
    function fit() {
      const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
      cell = Math.max(8, Math.floor(Math.min((w - 2) / COLS, (h - 2) / rows)));
      ctx = sizeCanvas(cv, COLS * cell, rows * cell); draw();
    }
    function draw() {
      if (!ctx) return;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, COLS * cell, rows * cell);
      ctx.fillStyle = C.line;
      for (let y = 0; y < rows; y++) for (let x = 0; x < COLS; x++) ctx.fillRect(x * cell + cell / 2 - 1, y * cell + cell / 2 - 1, 2, 2);
      if (food) {
        ctx.shadowColor = C.amber; ctx.shadowBlur = 8; ctx.fillStyle = C.amber;
        ctx.fillRect(food.x * cell + 3, food.y * cell + 3, cell - 6, cell - 6); ctx.shadowBlur = 0;
      }
      body.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? (dead ? C.red : C.accent) : C.accentDim;
        if (i === 0) { ctx.shadowColor = dead ? C.red : C.accent; ctx.shadowBlur = 10; }
        ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2); ctx.shadowBlur = 0;
      });
    }
    const delay = () => { const base = SPEED[PH.store.get('snakeSpeed')] || SPEED.normal; return Math.max(base * 0.6, base - score * 1.5); };
    function tick() {
      if (queue.length) dir = queue.shift();
      let x = body[0].x + dir.x, y = body[0].y + dir.y;
      if (PH.store.get('snakeWrap')) { x = (x + COLS) % COLS; y = (y + rows) % rows; }
      else if (x < 0 || y < 0 || x >= COLS || y >= rows) return over();
      const eat = food && x === food.x && y === food.y;
      if ((eat ? body : body.slice(0, -1)).some(p => p.x === x && p.y === y)) return over();
      body.unshift({ x, y });
      if (eat) { score++; placeFood(); if (score > data.best.snake) { data.best.snake = score; newBest = true; save(); } stats(); if (!food) return over(); }
      else body.pop();
      draw(); timer = setTimeout(tick, delay());
    }
    function start() {
      if (state === 'over') reset();
      state = 'run'; ov.hidden = true; clearTimeout(timer); timer = setTimeout(tick, delay()); syncKeys();
    }
    function pause() {
      if (state !== 'run') return;
      clearTimeout(timer); state = 'pause'; syncKeys();
      overlay(ov, { title: 'Paused', lines: ['Score ' + fmt(score)], primary: 'Resume', onPrimary: start });
    }
    function over() {
      clearTimeout(timer); state = 'over'; dead = true; draw(); refreshHome(); syncKeys();
      overlay(ov, { title: 'Game over', lines: ['Score ' + fmt(score) + ' · Best ' + fmt(data.best.snake)], best: newBest && score > 0, primary: 'Play again', onPrimary: start });
    }
    function ready() {
      clearTimeout(timer); state = 'ready'; reset(); syncKeys();
      const walls = PH.store.get('snakeWrap') ? 'Walls wrap around.' : "Don't hit the walls or yourself.";
      overlay(ov, { title: 'Snake', lines: ['Swipe anywhere on the screen to steer. Eat the amber dots.', walls], primary: 'Play', onPrimary: start });
    }
    const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    function steer(name) {
      const d = DIRS[name]; if (!d) return;
      if (state !== 'run') {
        if (state === 'over') reset();
        if (!(d.x === -dir.x && d.y === -dir.y)) queue = [d];
        start(); return;
      }
      const last = queue.length ? queue[queue.length - 1] : dir;
      if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
      if (queue.length < 3) queue.push(d);
    }
    ownTouches(view); onSwipe(view, steer);
    PH.on('snakeWrap', () => { if (state === 'ready') ready(); });
    ready();
    return {
      show() { if (state === 'ready') ready(); else fit(); },
      hide: pause, fit, pause, newGame: ready, key: steer,
      get paused() { return state === 'pause'; },
      act(a) { if (a === 'pause') state === 'run' ? pause() : state === 'pause' && start(); if (a === 'new') ready(); },
      space() { state === 'run' ? pause() : start(); },
    };
  })();

  /* ======================================================================
     2048
     ====================================================================== */
  const g2048 = (() => {
    const wrap = $('#g2048-wrap'), view = wrap.closest('.view'), box = $('#g2048-box'), grid = $('#g2048-grid'), ov = $('#g2048-ov');
    const cells = Array.from({ length: 16 }, () => { const d = document.createElement('div'); d.className = 'cell'; d.setAttribute('role', 'gridcell'); grid.appendChild(d); return d; });
    let s, prev = null;
    const valid = g => g && Array.isArray(g.g) && g.g.length === 16;

    function persist() { data.g2048 = s; if (s.score > data.best.g2048) { data.best.g2048 = s.score; s.beat = true; } save(); }
    function add() {
      const empty = s.g.map((v, i) => v ? -1 : i).filter(i => i >= 0);
      if (!empty.length) return -1;
      const i = empty[Math.random() * empty.length | 0]; s.g[i] = Math.random() < .9 ? 2 : 4; return i;
    }
    function newGame() {
      s = { g: Array(16).fill(0), score: 0, won: false, keep: false, over: false };
      prev = null; add(); add(); persist(); ov.hidden = true; render(); refreshHome();
    }
    function lines(dir) {
      const L = [];
      for (let a = 0; a < 4; a++) {
        const l = [];
        for (let b = 0; b < 4; b++) l.push(dir === 'left' || dir === 'right' ? a * 4 + b : b * 4 + a);
        L.push(dir === 'right' || dir === 'down' ? l.reverse() : l);
      }
      return L;
    }
    function canMove() {
      if (s.g.includes(0)) return true;
      for (let i = 0; i < 16; i++) { if (i % 4 < 3 && s.g[i] === s.g[i + 1]) return true; if (i < 12 && s.g[i] === s.g[i + 4]) return true; }
      return false;
    }
    function move(dir) {
      if (s.over || (s.won && !s.keep)) return;
      const before = JSON.parse(JSON.stringify(s)), merged = new Set();
      let moved = false, gain = 0;
      lines(dir).forEach(idx => {
        const vals = idx.map(i => s.g[i]).filter(Boolean), out = [], mpos = [];
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] === vals[i + 1]) { out.push(vals[i] * 2); gain += vals[i] * 2; mpos.push(out.length - 1); i++; }
          else out.push(vals[i]);
        }
        while (out.length < 4) out.push(0);
        idx.forEach((gi, k) => { if (s.g[gi] !== out[k]) moved = true; s.g[gi] = out[k]; });
        mpos.forEach(k => merged.add(idx[k]));
      });
      if (!moved) return;
      prev = before; s.score += gain;
      const fresh = add();
      if (!s.won && s.g.includes(2048)) s.won = true;
      if (!canMove()) s.over = true;
      persist(); render(fresh, merged);
      if (s.won && !s.keep) overlay(ov, { title: 'You made 2048', lines: ['Score ' + fmt(s.score)], primary: 'Keep going', onPrimary: () => { s.keep = true; persist(); ov.hidden = true; }, secondary: 'New game', onSecondary: newGame });
      else if (s.over) { refreshHome(); overlay(ov, { title: 'No moves left', lines: ['Score ' + fmt(s.score) + ' · Best ' + fmt(data.best.g2048)], best: !!s.beat, primary: 'New game', onPrimary: newGame, secondary: 'Undo', onSecondary: undo }); }
    }
    function undo() {
      if (!prev) { PH.toast('Nothing to undo.', 'warn'); return; }
      s = prev; prev = null; persist(); ov.hidden = true; render();
    }
    function render(fresh = -1, merged = new Set()) {
      s.g.forEach((v, i) => {
        const c = cells[i], digits = String(v).length;
        c.textContent = v || '';
        c.className = 'cell' + (v ? ' tile t' + Math.min(12, Math.log2(v)) : '') + (digits >= 3 ? ' d' + Math.min(5, digits) : '')
          + (i === fresh ? ' pop' : '') + (merged.has(i) ? ' merge' : '');
        c.setAttribute('aria-label', v ? String(v) : 'empty');
      });
      $('#g2048-score').textContent = fmt(s.score); $('#g2048-best').textContent = fmt(data.best.g2048);
    }
    function fit() {
      const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
      const size = Math.floor(Math.min(w, h, 520)) - 2;
      box.style.width = box.style.height = size + 'px';
      grid.style.setProperty('--cs', ((size - 30) / 4) + 'px');
    }
    async function askNew() {
      if (s.score > 0 && !s.over && !(await PH.confirm('Start a new game? Your current score of ' + fmt(s.score) + ' ends here.', { title: 'New game', ok: 'New game' }))) return;
      newGame();
    }
    ownTouches(view); onSwipe(view, move);

    if (valid(data.g2048)) { s = data.g2048; render(); if (s.over) overlay(ov, { title: 'No moves left', lines: ['Score ' + fmt(s.score)], primary: 'New game', onPrimary: newGame }); }
    else newGame();
    return { show: fit, hide() {}, fit, newGame: askNew, reset: newGame, key: move, act(a) { if (a === 'undo') undo(); if (a === 'new') askNew(); } };
  })();

  /* ======================================================================
     MINES
     ====================================================================== */
  const mines = (() => {
    const wrap = $('#mines-wrap'), board = $('#mines-board');
    // width is fixed per level; the field is as tall as the screen allows, mines scale with its size
    const SIZES = { easy: { c: 8, d: .125 }, normal: { c: 9, d: .16 }, hard: { c: 10, d: .2 } };
    let cfg, diff, cells, btns = [], started, ended, flags, opened, hit, elapsed, t0, iv = null, mode = 'dig';

    function newGame() {
      diff = SIZES[PH.store.get('minefield')] ? PH.store.get('minefield') : 'easy';
      const c = SIZES[diff].c, w = wrap.clientWidth, h = wrap.clientHeight;
      const r = w && h ? Math.max(c, Math.min(24, Math.floor((h - 4) / ((w - 4) / c)))) : Math.round(c * 1.5);
      cfg = { c, r, m: Math.round(c * r * SIZES[diff].d) };
      cells = Array.from({ length: cfg.c * cfg.r }, () => ({ mine: false, n: 0, open: false, flag: false }));
      started = ended = false; flags = opened = 0; hit = -1; elapsed = 0; stopTimer();
      board.textContent = ''; board.classList.remove('done'); board.style.setProperty('--cols', cfg.c);
      btns = cells.map((_, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i; board.appendChild(b); return b; });
      fit(); render();
    }
    const secs = () => Math.floor((elapsed + (iv !== null ? Date.now() - t0 : 0)) / 1000);
    function startTimer() { if (iv !== null) return; t0 = Date.now(); iv = setInterval(stats, 1000); }
    function stopTimer() { if (iv !== null) { elapsed += Date.now() - t0; clearInterval(iv); iv = null; } }
    function stats() {
      $('#mines-left').textContent = cfg.m - flags;
      $('#mines-time').textContent = fmtTime(secs());
      $('#mines-best').textContent = fmtTime(data.best.mines[diff]);
    }
    function around(i) {
      const x = i % cfg.c, y = (i / cfg.c) | 0, out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cfg.c && ny < cfg.r) out.push(ny * cfg.c + nx);
      }
      return out;
    }
    function plant(safe) {
      const keep = new Set([safe, ...around(safe)]);
      const pool = cells.map((_, i) => i).filter(i => !keep.has(i));
      for (let k = pool.length - 1; k > 0; k--) { const j = Math.random() * (k + 1) | 0; [pool[k], pool[j]] = [pool[j], pool[k]]; }
      pool.slice(0, cfg.m).forEach(i => { cells[i].mine = true; });
      cells.forEach((c, i) => { c.n = around(i).filter(j => cells[j].mine).length; });
    }
    function reveal(i) {
      const c = cells[i]; if (ended || c.open || c.flag) return;
      if (!started) { plant(i); started = true; startTimer(); }
      if (c.mine) return lose(i);
      const stack = [i];
      while (stack.length) {
        const j = stack.pop(), d = cells[j];
        if (d.open || d.flag || d.mine) continue;
        d.open = true; opened++;
        if (d.n === 0) stack.push(...around(j));
      }
      if (opened === cells.length - cfg.m) win();
    }
    function chord(i) {
      const c = cells[i]; if (!c.open || !c.n) return;
      const nb = around(i);
      if (nb.filter(j => cells[j].flag).length !== c.n) return;
      for (const j of nb) { if (ended) break; if (!cells[j].flag && !cells[j].open) reveal(j); }
    }
    function toggleFlag(i) {
      const c = cells[i]; if (ended || c.open) return;
      c.flag = !c.flag; flags += c.flag ? 1 : -1; render();
    }
    function lose(i) {
      ended = true; hit = i; stopTimer(); board.classList.add('done');
      PH.toast('Boom. Tap ⟳ for a new field.', 'warn'); refreshHome();
    }
    function win() {
      ended = true; stopTimer(); board.classList.add('done');
      cells.forEach(c => { if (c.mine && !c.flag) { c.flag = true; flags++; } });
      const t = secs(), best = data.best.mines[diff], isBest = best == null || t < best;
      if (isBest) { data.best.mines[diff] = t; save(); }
      PH.toast('Cleared in ' + fmtTime(t) + '.' + (isBest ? ' New best!' : '')); refreshHome();
    }
    function render() {
      cells.forEach((c, i) => {
        const b = btns[i]; let t = '', cls = '';
        if (c.open) { cls = 'open' + (c.n ? ' n' + c.n : ''); t = c.n || ''; }
        else if (ended && hit >= 0 && c.mine && !c.flag) { cls = 'open mine' + (i === hit ? ' hit' : ''); t = '●'; }
        else if (c.flag) { cls = (ended && hit >= 0 && !c.mine) ? 'wrong' : 'flag'; t = (ended && hit >= 0 && !c.mine) ? '✕' : '▲'; }
        b.className = cls; b.textContent = t;
        b.setAttribute('aria-label', c.open ? (c.n ? c.n + ' nearby' : 'clear') : c.flag ? 'flagged' : 'hidden');
      });
      stats();
    }
    function fit() {
      const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h || !cfg) return;
      const cell = Math.floor(Math.min((w - 6 - (cfg.c - 1) * 2) / cfg.c, (h - 6 - (cfg.r - 1) * 2) / cfg.r, 60));
      board.style.setProperty('--cell', Math.max(18, cell) + 'px');
    }
    function setMode(m) {
      mode = m;
      $('.page-keys [data-act="flag"]').setAttribute('aria-pressed', String(m === 'flag'));
      if (m === 'flag') PH.toast('Flag mode: taps place flags.');
    }
    // taps, long-press flag, right-click flag
    let lpT = null, lpFired = false, px = 0, py = 0, ptype = '';
    board.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b) return;
      ptype = e.pointerType; lpFired = false; px = e.clientX; py = e.clientY; clearTimeout(lpT);
      if (cells[+b.dataset.i].open) return;
      lpT = setTimeout(() => { lpFired = true; toggleFlag(+b.dataset.i); }, 420);
    });
    board.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - px, e.clientY - py) > 10) clearTimeout(lpT); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => board.addEventListener(t, () => clearTimeout(lpT)));
    board.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (lpFired) { lpFired = false; return; }
      const i = +b.dataset.i;
      if (cells[i].open) chord(i); else if (mode === 'flag') toggleFlag(i); else reveal(i);
      render();
    });
    board.addEventListener('contextmenu', e => {
      e.preventDefault();
      const b = e.target.closest('button'); if (b && ptype === 'mouse') toggleFlag(+b.dataset.i);
    });
    ownTouches(wrap.closest('.view'));
    PH.on('minefield', () => { if (!started || ended) newGame(); });
    newGame();
    return {
      show() { if (!started && !ended) newGame(); else fit(); if (started && !ended) startTimer(); stats(); },
      hide: stopTimer, pause: stopTimer, newGame, key() {},
      fit() { if (!started && !ended) newGame(); else fit(); },
      act(a) { if (a === 'new') newGame(); if (a === 'flag') setMode(mode === 'flag' ? 'dig' : 'flag'); },
    };
  })();

  /* ======================================================================
     BLOCKS (falling-block puzzle)
     ====================================================================== */
  const blocks = (() => {
    const wrap = $('#blocks-wrap'), view = wrap.closest('.view'), cv = $('#blocks-cv'), nextCv = $('#blocks-next'), ov = $('#blocks-ov');
    const W = 10, H = 20;
    const SHAPES = {
      I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], O: [[1, 1], [1, 1]],
      T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
      J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    };
    const COLOR = { I: C.cyan, O: C.amber, T: C.accent, S: C.accentDim, Z: C.red, J: C.text, L: C.dim };
    const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
    let ctx, nctx, cell = 20, grid, cur, next, bag = [], score, lines, level, state = 'ready', raf = 0, last = 0, acc = 0, lockT = null, resets = 0, newBest = false;

    const rot = m => m[0].map((_, c) => m.map(r => r[c]).reverse());
    const pull = () => { if (!bag.length) { bag = Object.keys(SHAPES); for (let i = bag.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); };
    function collide(m, x, y) {
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const X = x + c, Y = y + r;
        if (X < 0 || X >= W || Y >= H) return true;
        if (Y >= 0 && grid[Y][X]) return true;
      }
      return false;
    }
    function reset() {
      grid = Array.from({ length: H }, () => Array(W).fill(0));
      bag = []; next = pull(); score = 0; lines = 0; level = 1; newBest = false; spawn(); stats();
    }
    function spawn() {
      const k = next; next = pull();
      const m = SHAPES[k].map(r => r.slice());
      cur = { k, m, x: Math.floor((W - m[0].length) / 2), y: k === 'I' ? -1 : 0 };
      lockT = null; resets = 0; drawNext();
      if (collide(cur.m, cur.x, cur.y)) over();
    }
    function stats() {
      $('#blocks-score').textContent = fmt(score); $('#blocks-level').textContent = level;
    }
    const gravity = () => Math.max(70, 800 * Math.pow(0.84, level - 1));
    function touched() { if (lockT !== null && resets < 15) { lockT = performance.now(); resets++; } }
    function shift(dx) { if (state === 'run' && !collide(cur.m, cur.x + dx, cur.y)) { cur.x += dx; touched(); draw(); } }
    function turn() {
      if (state !== 'run') return;
      const m = rot(cur.m);
      for (const [kx, ky] of KICKS) if (!collide(m, cur.x + kx, cur.y + ky)) { cur.m = m; cur.x += kx; cur.y += ky; touched(); draw(); return; }
    }
    function soft() { if (state === 'run' && !collide(cur.m, cur.x, cur.y + 1)) { cur.y++; score += 1; acc = 0; stats(); draw(); } }
    function hard() {
      if (state !== 'run') return;
      let n = 0; while (!collide(cur.m, cur.x, cur.y + 1)) { cur.y++; n++; }
      score += 2 * n; lock();
    }
    function lock() {
      let top = false;
      cur.m.forEach((row, r) => row.forEach((v, c) => { if (!v) return; const Y = cur.y + r; if (Y < 0) top = true; else grid[Y][cur.x + c] = cur.k; }));
      if (top) { stats(); return over(); }
      let n = 0;
      for (let y = H - 1; y >= 0; y--) if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(Array(W).fill(0)); n++; y++; }
      if (n) { score += [0, 100, 300, 500, 800][n] * level; lines += n; level = 1 + Math.floor(lines / 10); }
      if (score > data.best.blocks) { data.best.blocks = score; newBest = true; save(); }
      stats(); spawn(); draw();
    }
    function loop(t) {
      if (state !== 'run') return;
      raf = requestAnimationFrame(loop);
      acc += Math.min(250, t - last); last = t;
      if (collide(cur.m, cur.x, cur.y + 1)) {
        acc = 0;
        if (lockT === null) lockT = t;
        else if (t - lockT > 450) lock();
      } else {
        lockT = null;
        const g = gravity();
        while (acc >= g) { acc -= g; if (collide(cur.m, cur.x, cur.y + 1)) break; cur.y++; }
      }
      draw();
    }
    function cellAt(c, x, y, s, color, ghost) {
      if (ghost) { c.strokeStyle = color; c.globalAlpha = .5; c.lineWidth = 1; c.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3); c.globalAlpha = 1; return; }
      c.fillStyle = color; c.fillRect(x + 1, y + 1, s - 2, s - 2);
      c.fillStyle = 'rgba(3,7,3,.38)'; c.fillRect(x + s * .3, y + s * .3, s * .4, s * .4);
    }
    function draw() {
      if (!ctx || !grid) return;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W * cell, H * cell);
      ctx.fillStyle = C.line;
      for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) ctx.fillRect(x * cell - 1, y * cell - 1, 2, 2);
      grid.forEach((row, y) => row.forEach((k, x) => { if (k) cellAt(ctx, x * cell, y * cell, cell, COLOR[k]); }));
      if (!cur || state === 'ready') return;
      if (PH.store.get('ghost') && state !== 'over') {
        let gy = cur.y; while (!collide(cur.m, cur.x, gy + 1)) gy++;
        if (gy !== cur.y) cur.m.forEach((row, r) => row.forEach((v, c) => { if (v && gy + r >= 0) cellAt(ctx, (cur.x + c) * cell, (gy + r) * cell, cell, COLOR[cur.k], true); }));
      }
      cur.m.forEach((row, r) => row.forEach((v, c) => { if (v && cur.y + r >= 0) cellAt(ctx, (cur.x + c) * cell, (cur.y + r) * cell, cell, COLOR[cur.k]); }));
    }
    function drawNext() {
      if (!nctx) nctx = sizeCanvas(nextCv, 32, 16);
      nctx.clearRect(0, 0, 32, 16);
      const m = SHAPES[next].filter(r => r.some(Boolean)), s = 8, ox = (32 - m[0].length * s) / 2, oy = (16 - m.length * s) / 2;
      m.forEach((row, r) => row.forEach((v, c) => { if (v) cellAt(nctx, ox + c * s, oy + r * s, s, COLOR[next]); }));
    }
    function fit() {
      const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
      cell = Math.max(10, Math.floor(Math.min((w - 2) / W, (h - 2) / H)));
      ctx = sizeCanvas(cv, W * cell, H * cell); draw();
    }
    function start() {
      if (state === 'over' || state === 'ready') reset();
      if (state === 'over') return;   // topped out on spawn
      state = 'run'; ov.hidden = true; last = performance.now(); acc = 0; syncKeys();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    }
    function pause() {
      if (state !== 'run') return;
      state = 'pause'; cancelAnimationFrame(raf); syncKeys();
      overlay(ov, { title: 'Paused', lines: ['Score ' + fmt(score) + ' · Lines ' + lines], primary: 'Resume', onPrimary: resume });
    }
    function resume() { if (state !== 'pause') return; state = 'run'; ov.hidden = true; syncKeys(); last = performance.now(); raf = requestAnimationFrame(loop); }
    function over() {
      state = 'over'; cancelAnimationFrame(raf); draw(); refreshHome(); syncKeys();
      overlay(ov, { title: 'Game over', lines: ['Score ' + fmt(score) + ' · Lines ' + lines, 'Best ' + fmt(data.best.blocks)], best: newBest && score > 0, primary: 'Play again', onPrimary: () => { state = 'ready'; start(); } });
    }
    function ready() {
      state = 'ready'; cancelAnimationFrame(raf); reset(); draw(); syncKeys();
      overlay(ov, { title: 'Blocks', lines: ['Drag anywhere to move, tap to rotate, drag down to speed up, flick down to drop.', 'Best ' + fmt(data.best.blocks)], primary: 'Play', onPrimary: start });
    }

    // touch: drag moves cell by cell, tap rotates, quick flick down hard-drops
    ownTouches(view);
    let tx = null, ty, lx, ly, tt, moved;
    view.addEventListener('touchstart', e => {
      if (e.target.closest('.overlay')) return;
      const t = e.touches[0]; tx = lx = t.clientX; ty = ly = t.clientY; tt = performance.now(); moved = false;
    }, { passive: true });
    view.addEventListener('touchmove', e => {
      if (tx === null || state !== 'run') return;
      const t = e.touches[0], step = Math.max(14, cell * .9);
      while (t.clientX - lx >= step) { shift(1); lx += step; moved = true; }
      while (lx - t.clientX >= step) { shift(-1); lx -= step; moved = true; }
      while (t.clientY - ly >= step * 1.2) { soft(); ly += step * 1.2; moved = true; }
    }, { passive: true });
    view.addEventListener('touchend', e => {
      if (tx === null) return;
      const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty, dt = performance.now() - tt; tx = null;
      if (state !== 'run') return;
      if (dy > 50 && dt < 260 && Math.abs(dx) < dy * .6) hard();
      else if (!moved && Math.hypot(dx, dy) < 12) turn();
    }, { passive: true });
    view.addEventListener('click', e => { if (!('ontouchstart' in window) && state === 'run' && !e.target.closest('.overlay')) turn(); });

    PH.on('ghost', draw);
    ready();
    return {
      show: fit, hide: pause, fit, pause, newGame: ready,
      get paused() { return state === 'pause'; },
      act(a) { if (a === 'pause') state === 'run' ? pause() : state === 'pause' ? resume() : start(); if (a === 'new') ready(); },
      key(d) { if (state !== 'run') return; ({ left: () => shift(-1), right: () => shift(1), down: soft, up: turn })[d](); },
      space() { state === 'run' ? hard() : state === 'pause' ? resume() : start(); },
    };
  })();

  /* ======================================================================
     PIN RESCUE (the pull-the-pin puzzle from the ads, with no ads)
     ====================================================================== */
  const pins = (() => {
    const wrap = $('#pins-wrap'), view = wrap.closest('.view'), cv = $('#pins-cv'), ov = $('#pins-ov');
    const W = 18, H = 28, STEP = 40;
    const E = 0, WALL = 1, PIN = 2, GOLD = 3, WATER = 4, LAVA = 5, STONE = 6, HERO = 7, MON = 8;
    const N4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    // ops: [type, x0, y0, x1, y1] filled inclusive; 'p' adds a pin. hero/monsters are 2x3, given by top-left.
    const monster = {
      name: 'Monster',
      ops: [
        ['#', 6, 0, 6, 17], ['#', 7, 17, 10, 17],
        ['g', 0, 0, 5, 3], ['p', 0, 4, 5, 4],
        ['w', 0, 5, 5, 8], ['p', 0, 9, 5, 9],
        ['l', 0, 10, 5, 12], ['p', 0, 13, 5, 13],
        ['#', 11, 12, 11, 21], ['p', 11, 22, 11, 25], ['#', 11, 26, 11, 27],
      ],
      hero: [15, 25], mons: [[4, 25]], sol: [2, 1, 0, 3],
    };
    const mirror = L => ({
      ops: L.ops.map(([c, x0, y0, x1, y1]) => [c, W - 1 - x1, y0, W - 1 - x0, y1]),
      hero: [W - 2 - L.hero[0], L.hero[1]], mons: L.mons.map(([x, y]) => [W - 2 - x, y]),
    });
    const LEVELS = [
      { name: 'Gold rush', ops: [['#', 0, 0, 1, 5], ['#', 16, 0, 17, 5], ['g', 2, 1, 15, 4], ['p', 2, 5, 15, 5]], hero: [8, 25], mons: [], sol: [0] },
      { name: 'Pick one', ops: [['#', 8, 0, 9, 9], ['l', 0, 3, 7, 8], ['p', 0, 9, 7, 9], ['g', 10, 3, 17, 8], ['p', 10, 9, 17, 9]], hero: [8, 25], mons: [], sol: [1] },
      { name: 'Cool it', ops: [
        ['g', 0, 2, 5, 7], ['#', 6, 0, 6, 8], ['p', 0, 8, 5, 8],
        ['w', 7, 2, 12, 7], ['#', 13, 0, 13, 8], ['p', 7, 8, 12, 8],
        ['l', 0, 21, 12, 27], ['#', 13, 21, 13, 27],
      ], hero: [15, 25], mons: [], sol: [1, 0] },
      monster,
      { name: 'Too many pins', ...(() => { const m = mirror(monster);
        m.ops.push(['#', 0, 3, 5, 3], ['#', 5, 4, 5, 8], ['l', 0, 4, 4, 7], ['p', 0, 8, 4, 8]); return m; })(), sol: [2, 1, 0, 3] },
    ];

    let ctx, cell = 20, g, pid, dir, stamp, pinList = [], hero, mons = [], li = Math.min(data.pins || 0, LEVELS.length - 1);
    let total = 0, need = 0, got = 0, tick = 0, ending = null, lastGot = 0, stampGot = 0, stampGotVal = 0, state = 'ready', raf = 0, last = 0, acc = 0;

    const at = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? WALL : g[y * W + x];
    function mark(e, t) { for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) g[y * W + x] = t; }
    function unmark(e, t) { for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (g[y * W + x] === t) g[y * W + x] = E; }
    const free = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (at(i, j) !== E) return false; return true; };

    function load(i) {
      li = i; const L = LEVELS[i];
      g = new Uint8Array(W * H); pid = new Int16Array(W * H).fill(-1); dir = new Int8Array(W * H); stamp = new Uint32Array(W * H); pinList = [];
      const T = { '#': WALL, g: GOLD, w: WATER, l: LAVA, p: PIN };
      L.ops.forEach(([c, x0, y0, x1, y1]) => {
        const id = c === 'p' ? pinList.push({ x0, y0, x1, y1, out: 0 }) - 1 : -1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * W + x; g[k] = T[c]; pid[k] = id; dir[k] = Math.random() < .5 ? -1 : 1; }
      });
      hero = { x: L.hero[0], y: L.hero[1], w: 2, h: 3, mood: 0 };
      mons = L.mons.map(([x, y]) => ({ x, y, w: 2, h: 3, alive: true, gone: 0 }));
      mark(hero, HERO); mons.forEach(m => mark(m, MON));
      total = g.reduce((n, t) => n + (t === GOLD), 0); need = Math.ceil(total * .6);
      got = lastGot = tick = stampGot = stampGotVal = 0; ending = null;
      stats(); draw();
    }
    function stats() { $('#pins-level').textContent = (li + 1) + '/' + LEVELS.length; $('#pins-gold').textContent = got + '/' + need; }

    function move(a, b) { g[b] = g[a]; dir[b] = dir[a]; g[a] = E; stamp[b] = tick; }
    function swap(a, b) { const t = g[b], d = dir[b]; g[b] = g[a]; dir[b] = dir[a]; g[a] = t; dir[a] = d; stamp[a] = stamp[b] = tick; }
    function fall(e, t) {
      if (!free(e.x, e.y + e.h, e.w, 1)) return;
      unmark(e, t); e.y++; mark(e, t);
    }
    function walk(m) {
      if (free(m.x, m.y + m.h, m.w, 1)) return;
      const d = Math.sign(hero.x - m.x); if (!d) return;
      unmark(m, MON);
      for (const up of [0, 1, 2]) if (free(m.x + d, m.y - up, m.w, m.h)) { m.x += d; m.y -= up; break; }
      mark(m, MON);
    }
    function kill(m) { if (!m || !m.alive) return; unmark(m, MON); m.alive = false; m.gone = tick; }
    const monAt = (x, y) => mons.find(m => m.alive && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
    function end(won, reason) { if (ending) return; ending = { won, reason, t: tick }; hero.mood = won ? 1 : -1; }

    function step() {
      tick++;
      // particles: gold sinks through water, liquids spread, lava moves at half speed
      for (let y = H - 1; y >= 0; y--) {
        const ltr = (tick + y) & 1;
        for (let i = 0; i < W; i++) {
          const x = ltr ? i : W - 1 - i, k = y * W + x, t = g[k];
          if (t < GOLD || t > LAVA || stamp[k] === tick || (t === LAVA && tick & 1)) continue;
          const open = (xx, yy) => { const c = at(xx, yy); return c === E || (t === GOLD && c === WATER); };
          const go = (xx, yy) => { const j = yy * W + xx; g[j] === E ? move(k, j) : swap(k, j); };
          const d = dir[k];
          if (open(x, y + 1)) go(x, y + 1);
          else if (open(x + d, y) && open(x + d, y + 1)) go(x + d, y + 1);
          else if (open(x - d, y) && open(x - d, y + 1)) { dir[k] = -d; go(x - d, y + 1); }
          else if (open(x + d, y)) go(x + d, y);
          else { dir[k] = -d; if (open(x - d, y)) go(x - d, y); }
        }
      }
      // reactions
      for (let k = 0; k < W * H; k++) {
        const t = g[k]; if (t !== WATER && t !== LAVA && t !== GOLD) continue;
        const x = k % W, y = (k / W) | 0;
        for (const [dx, dy] of N4) {
          const u = at(x + dx, y + dy), j = (y + dy) * W + x + dx;
          if (t === WATER && u === LAVA) { g[j] = STONE; g[k] = E; break; }
          if (t === LAVA && u === GOLD) g[j] = E;
          else if (t === LAVA && u === HERO) end(false, 'The lava got the hero.');
          else if (t === LAVA && u === MON) kill(monAt(x + dx, y + dy));
          else if (t === GOLD && u === HERO) { g[k] = E; got++; break; }
        }
      }
      if (tick % 2 === 0) { fall(hero, HERO); mons.forEach(m => m.alive && fall(m, MON)); }
      if (tick % 5 === 0) mons.forEach(m => m.alive && walk(m));
      mons.forEach(m => {
        if (m.alive && m.x <= hero.x + hero.w && hero.x <= m.x + m.w && m.y <= hero.y + hero.h && hero.y <= m.y + m.h) end(false, 'The monster got the hero.');
      });
      if (got !== lastGot) { lastGot = got; stats(); }
      if (got >= need) end(true);
      else if (g.reduce((n, t) => n + (t === GOLD), 0) + got < need) end(false, 'Not enough gold made it.');
      if (!ending && pinList.every(p => p.out) && tick - Math.max(pinList.reduce((a, p) => Math.max(a, p.tick), 0), stampGot) > 125) end(false, 'The gold is stuck.');
      if (got !== stampGotVal) { stampGotVal = got; stampGot = tick; }
      if (ending && tick - ending.t > 25) finish();
    }
    function pull(p) {
      p.out = performance.now(); p.tick = tick;
      const id = pinList.indexOf(p);
      for (let k = 0; k < W * H; k++) if (pid[k] === id && g[k] === PIN) g[k] = E;
    }

    /* drawing */
    function draw() {
      if (!ctx || !g) return;
      const s = cell, now = performance.now();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W * s, H * s);
      ctx.fillStyle = C.line;
      for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) ctx.fillRect(x * s - 1, y * s - 1, 2, 2);
      for (let k = 0; k < W * H; k++) {
        const t = g[k], x = (k % W) * s, y = ((k / W) | 0) * s;
        if (t === WALL) { ctx.fillStyle = C.line; ctx.fillRect(x, y, s, s); }
        else if (t === STONE) { ctx.fillStyle = C.dim; ctx.globalAlpha = .4; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(x + s * .2, y + s * .25, s * .2, s * .15); }
        else if (t === WATER) { ctx.fillStyle = C.cyan; ctx.globalAlpha = .6; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; }
        else if (t === LAVA) { ctx.fillStyle = C.red; ctx.fillRect(x, y, s, s); if (Math.random() < .08) { ctx.fillStyle = C.amber; ctx.fillRect(x + s * .3, y + s * .3, s * .3, s * .3); } }
        else if (t === GOLD) { ctx.fillStyle = C.amber; ctx.fillRect(x + 1, y + 1, s - 2, s - 2); ctx.fillStyle = 'rgba(3,7,3,.3)'; ctx.fillRect(x + s * .55, y + s * .55, s * .25, s * .25); }
      }
      // pins: a bar with a ring handle; pulled pins slide out and fade
      pinList.forEach(p => {
        const k = p.out ? Math.min(1, (now - p.out) / 300) : 0; if (k >= 1) return;
        const horiz = p.x1 > p.x0 || p.y1 === p.y0, len = horiz ? (p.x1 - p.x0 + 1) * s : (p.y1 - p.y0 + 1) * s, off = k * len;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = C.text; ctx.strokeStyle = C.text; ctx.lineWidth = Math.max(2, s * .14);
        ctx.shadowColor = C.accent; ctx.shadowBlur = 6;
        if (horiz) {
          const y = (p.y0 + .5) * s, x0 = p.x0 * s + off, x1 = (p.x1 + 1) * s + off;
          ctx.fillRect(x0, y - s * .18, x1 - x0 - s * .7, s * .36);
          ctx.beginPath(); ctx.arc(x1 - s * .4, y, s * .32, 0, 7); ctx.stroke();
        } else {
          const x = (p.x0 + .5) * s, y0 = p.y0 * s - off, y1 = (p.y1 + 1) * s - off;
          ctx.fillRect(x - s * .18, y0 + s * .7, s * .36, y1 - y0 - s * .7);
          ctx.beginPath(); ctx.arc(x, y0 + s * .4, s * .32, 0, 7); ctx.stroke();
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      });
      mons.forEach(m => {
        const x = m.x * s, y = m.y * s;
        if (!m.alive) {   // a puff of smoke for a moment
          const k = (tick - m.gone) / 20; if (k > 1) return;
          ctx.globalAlpha = 1 - k; ctx.fillStyle = C.dim;
          for (let i = 0; i < 5; i++) ctx.fillRect(x + s * (.2 + (i % 3) * .6), y + s * (2 - k * 1.5 - (i % 2) * .6), s * .5, s * .5);
          ctx.globalAlpha = 1; return;
        }
        ctx.fillStyle = 'rgba(255,92,92,.22)'; ctx.strokeStyle = C.red; ctx.lineWidth = 2;
        ctx.fillRect(x + s * .15, y + s * .7, s * 1.7, s * 2.3); ctx.strokeRect(x + s * .15, y + s * .7, s * 1.7, s * 2.3);
        ctx.fillStyle = C.red;
        ctx.beginPath(); ctx.moveTo(x + s * .2, y + s * .7); ctx.lineTo(x + s * .35, y); ctx.lineTo(x + s * .7, y + s * .7);
        ctx.moveTo(x + s * 1.3, y + s * .7); ctx.lineTo(x + s * 1.65, y); ctx.lineTo(x + s * 1.8, y + s * .7); ctx.fill();
        ctx.fillStyle = C.amber; ctx.fillRect(x + s * .5, y + s * 1.2, s * .3, s * .3); ctx.fillRect(x + s * 1.2, y + s * 1.2, s * .3, s * .3);
        ctx.fillStyle = C.text; for (let i = 0; i < 4; i++) ctx.fillRect(x + s * (.45 + i * .3), y + s * 2.1, s * .15, s * .25);
      });
      if (hero) {
        const x = hero.x * s, y = hero.y * s, col = hero.mood < 0 ? C.red : C.text;
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s * .15);
        ctx.shadowColor = hero.mood < 0 ? C.red : C.accent; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x + s, y + s * .55, s * .45, 0, 7); ctx.fill();
        ctx.fillRect(x + s * .55, y + s * 1.1, s * .9, s * 1.1);
        ctx.fillRect(x + s * .55, y + s * 2.2, s * .3, s * .8); ctx.fillRect(x + s * 1.15, y + s * 2.2, s * .3, s * .8);
        ctx.beginPath();
        if (hero.mood > 0) { ctx.moveTo(x + s * .6, y + s * 1.3); ctx.lineTo(x + s * .15, y + s * .4); ctx.moveTo(x + s * 1.4, y + s * 1.3); ctx.lineTo(x + s * 1.85, y + s * .4); }
        else { ctx.moveTo(x + s * .6, y + s * 1.3); ctx.lineTo(x + s * .2, y + s * 2.1); ctx.moveTo(x + s * 1.4, y + s * 1.3); ctx.lineTo(x + s * 1.8, y + s * 2.1); }
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = C.bg; ctx.fillRect(x + s * .75, y + s * .45, s * .14, s * .14); ctx.fillRect(x + s * 1.11, y + s * .45, s * .14, s * .14);
      }
    }
    function fit() {
      const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
      cell = Math.max(8, Math.floor(Math.min((w - 2) / W, (h - 2) / H)));
      ctx = sizeCanvas(cv, W * cell, H * cell); draw();
    }

    /* loop and screens */
    function loop(t) {
      raf = requestAnimationFrame(loop);
      acc += Math.min(200, t - last); last = t;
      while (acc >= STEP && raf) { acc -= STEP; step(); }
      draw();
    }
    function resume() { if (state !== 'run' || raf || document.hidden) return; last = performance.now(); acc = 0; raf = requestAnimationFrame(loop); }
    function pause() { cancelAnimationFrame(raf); raf = 0; }
    function start() { ov.hidden = true; state = 'run'; resume(); }
    function play(i) { load(i); start(); }
    function finish() {
      pause(); draw(); state = 'end';
      const L = LEVELS.length;
      if (!ending.won) {
        overlay(ov, { title: 'So close', lines: [ending.reason, 'Level ' + (li + 1) + ': ' + LEVELS[li].name], primary: 'Try again', onPrimary: () => play(li) });
        return;
      }
      const isBest = li + 1 > (data.best.pins || 0);
      if (isBest) data.best.pins = li + 1;
      data.pins = (li + 1) % L; save(); refreshHome();
      if (li + 1 < L) overlay(ov, { title: 'Hero saved', lines: ['The hero collected ' + got + ' gold.'], primary: 'Next level', onPrimary: () => play(li + 1), secondary: 'Replay', onSecondary: () => play(li) });
      else overlay(ov, { title: 'All rescued', lines: ['You cleared all ' + L + ' levels.', 'Not a single ad.'], best: isBest, primary: 'Play again', onPrimary: () => play(0) });
    }
    function ready() {
      pause(); state = 'ready'; load(li);
      overlay(ov, {
        title: 'Pin Rescue', lines: ['Tap a pin to pull it. Get the gold to the hero and keep the lava and monsters away.', 'Level ' + (li + 1) + ' of ' + LEVELS.length + ': ' + LEVELS[li].name],
        primary: 'Play', onPrimary: start, ...(li ? { secondary: 'Start from level 1', onSecondary: () => play(0) } : {}),
      });
    }

    view.addEventListener('click', e => {
      if (state !== 'run' || ending || e.target.closest('.overlay')) return;
      const r = cv.getBoundingClientRect(), cx = (e.clientX - r.left) / cell - .5, cy = (e.clientY - r.top) / cell - .5;
      let best = null, bd = 1.6;
      pinList.forEach(p => {
        if (p.out) return;
        const d = Math.hypot(Math.max(p.x0 - cx, 0, cx - p.x1), Math.max(p.y0 - cy, 0, cy - p.y1));
        if (d < bd) { bd = d; best = p; }
      });
      if (best) pull(best);
    });
    ownTouches(view);
    if (/[?&]test\b/.test(location.search)) window.__pins = { LEVELS, load, step, draw, pull: i => pull(pinList[i]), get ending() { return ending; }, get got() { return got; }, get need() { return need; }, set state(v) { state = v; } };
    ready();
    return {
      show() { if (state === 'ready') ready(); fit(); resume(); },
      hide: pause, pause, resume, fit, key() {},
      newGame() { play(li); },
      act(a) { if (a === 'retry' || a === 'new') play(li); },
      reset() { li = 0; ready(); },
    };
  })();

  /* ======================================================================
     Shell: routing, home, settings, data
     ====================================================================== */
  const games = { '/snake': snake, '/2048': g2048, '/mines': mines, '/blocks': blocks, '/pins': pins };

  function refreshHome() {
    const b = data.best, m = b.mines;
    const bestMine = ['easy', 'normal', 'hard'].map(k => m[k]).find(v => v != null);
    $('#home-snake').textContent = b.snake ? 'Best ' + fmt(b.snake) : 'New';
    $('#home-2048').textContent = b.g2048 ? 'Best ' + fmt(b.g2048) : 'New';
    $('#home-blocks').textContent = b.blocks ? 'Best ' + fmt(b.blocks) : 'New';
    $('#home-pins').textContent = b.pins ? b.pins + ' of 5 cleared' : 'New';
    const md = PH.store.get('minefield');
    $('#home-mines').textContent = m[md] != null ? 'Best ' + fmtTime(m[md]) : bestMine != null ? 'Played' : 'New';
    $('#sc-snake').textContent = b.snake ? fmt(b.snake) : '—';
    $('#sc-2048').textContent = b.g2048 ? fmt(b.g2048) : '—';
    $('#sc-blocks').textContent = b.blocks ? fmt(b.blocks) : '—';
    $('#sc-pins').textContent = b.pins ? 'Level ' + b.pins : '—';
    ['easy', 'normal', 'hard'].forEach(k => { $('#sc-mines-' + k).textContent = fmtTime(m[k]); });
    $('#snake-best').textContent = fmt(b.snake); $('#g2048-best').textContent = fmt(b.g2048);
    $('#mines-best').textContent = fmtTime(m[PH.store.get('minefield')]);
  }

  PH.on('route', r => {
    const g = games[r] || null;
    if (active && active !== g) active.hide();
    active = g;
    $('#actions').hidden = $('#actions-title').hidden = !g;
    if (g) { g.show(); requestAnimationFrame(() => g.fit()); }
    syncKeys();
    if (!g) refreshHome();
  });
  addEventListener('resize', () => { active && active.fit(); });
  document.addEventListener('visibilitychange', () => { if (!active) return; if (document.hidden) active.pause && active.pause(); else active.resume && active.resume(); });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-sheet="menu"]') && active && active.pause && active !== mines && active !== pins) active.pause();
    const a = e.target.closest('[data-action]');
    if (a && active) a.dataset.action === 'new' ? active.newGame() : active.act && active.act(a.dataset.action);
    const k = e.target.closest('.page-keys [data-act]');
    if (k && active && active.act) { e.stopPropagation(); active.act(k.dataset.act); }
  }, true);
  addEventListener('keydown', e => {
    if (!active || $('dialog[open]')) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    if (map[e.key]) { e.preventDefault(); active.key(map[e.key]); }
    else if (e.key === ' ' && active.space) { e.preventDefault(); active.space(); }
    else if ((e.key === 'p' || e.key === 'Escape') && active.pause) active.pause();
  });
  PH.on('minefield', refreshHome);
  PH.on('rain', () => dispatchEvent(new Event('resize')));

  PH.init(DEFAULTS);
  refreshHome();

  $('#reset-display').onclick = () => { PH.store.set('crt', true); PH.store.set('rain', false); PH.toast('Display reset.'); };
  $('#export').onclick = () => {
    const settings = {}; Object.keys({ ...DEFAULTS, crt: 1, rain: 1 }).forEach(k => { settings[k] = PH.store.get(k); });
    PH.exportFile('phosphor-arcade-backup.json', JSON.stringify({ app: 'phosphor-arcade', version: '1.8', exported: new Date().toISOString(), best: data.best, game2048: data.g2048, settings }, null, 2));
  };
  $('#reset-scores').onclick = async () => {
    if (!(await PH.confirm('Reset all best scores and times? This can\'t be undone.', { title: 'Reset scores', ok: 'Reset', danger: true }))) return;
    data.best = blankBest(); save(); refreshHome(); PH.toast('Best scores reset.', 'warn');
  };
  $('#erase').onclick = async () => {
    if (!(await PH.confirm('Erase all best scores, your saved 2048 game, your Pin Rescue level and settings? This can\'t be undone.', { title: 'Erase data', ok: 'Erase', danger: true }))) return;
    data = blank(); try { localStorage.removeItem(DKEY); } catch {}
    PH.store.reset(); g2048.reset(); snake.newGame(); blocks.newGame(); mines.newGame(); pins.reset(); refreshHome();
    PH.toast('All data erased.', 'warn');
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
