/* Phosphor Arcade: Snake, 2048, Mines, Blocks. */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DEFAULTS = { snakeSpeed: 'normal', snakeWrap: false, minefield: 'easy', ghost: true };
  Object.assign(PH.store.defaults, DEFAULTS);   // so games can read settings before PH.init

  /* ---------- Tool data: best scores + saved 2048 game ---------- */
  const DKEY = 'phosphor-arcade:data';
  const blankBest = () => ({ snake: 0, g2048: 0, blocks: 0, mines: { easy: null, normal: null, hard: null } });
  const blank = () => ({ best: blankBest(), g2048: null });
  let data = (() => {
    try {
      const d = JSON.parse(localStorage.getItem(DKEY));
      if (d && d.best) {
        const b = blankBest();
        return { g2048: d.g2048 || null, best: { ...b, ...d.best, mines: { ...b.mines, ...(d.best.mines || {}) } } };
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
     Shell: routing, home, settings, data
     ====================================================================== */
  const games = { '/snake': snake, '/2048': g2048, '/mines': mines, '/blocks': blocks };

  function refreshHome() {
    const b = data.best, m = b.mines;
    const bestMine = ['easy', 'normal', 'hard'].map(k => m[k]).find(v => v != null);
    $('#home-snake').textContent = b.snake ? 'Best ' + fmt(b.snake) : 'New';
    $('#home-2048').textContent = b.g2048 ? 'Best ' + fmt(b.g2048) : 'New';
    $('#home-blocks').textContent = b.blocks ? 'Best ' + fmt(b.blocks) : 'New';
    const md = PH.store.get('minefield');
    $('#home-mines').textContent = m[md] != null ? 'Best ' + fmtTime(m[md]) : bestMine != null ? 'Played' : 'New';
    $('#sc-snake').textContent = b.snake ? fmt(b.snake) : '—';
    $('#sc-2048').textContent = b.g2048 ? fmt(b.g2048) : '—';
    $('#sc-blocks').textContent = b.blocks ? fmt(b.blocks) : '—';
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
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) active.pause && active.pause(); });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-sheet="menu"]') && active && active.pause && active !== mines) active.pause();
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
    PH.exportFile('phosphor-arcade-backup.json', JSON.stringify({ app: 'phosphor-arcade', version: '1.3', exported: new Date().toISOString(), best: data.best, game2048: data.g2048, settings }, null, 2));
  };
  $('#reset-scores').onclick = async () => {
    if (!(await PH.confirm('Reset all best scores and times? This can\'t be undone.', { title: 'Reset scores', ok: 'Reset', danger: true }))) return;
    data.best = blankBest(); save(); refreshHome(); PH.toast('Best scores reset.', 'warn');
  };
  $('#erase').onclick = async () => {
    if (!(await PH.confirm('Erase all best scores, your saved 2048 game and settings? This can\'t be undone.', { title: 'Erase data', ok: 'Erase', danger: true }))) return;
    data = blank(); try { localStorage.removeItem(DKEY); } catch {}
    PH.store.reset(); g2048.reset(); snake.newGame(); blocks.newGame(); mines.newGame(); refreshHome();
    PH.toast('All data erased.', 'warn');
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
