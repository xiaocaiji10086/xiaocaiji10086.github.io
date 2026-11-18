/* ============================================================
   NEON SNAKE — 纯前端贪吃蛇
   Canvas 渲染 + localStorage + 公共共享排行榜
   ============================================================ */

(() => {
  'use strict';

  /* ---------- 常量 ---------- */

  const COLS = 24;
  const ROWS = 24;

  const BASE_TICK = 150;      // 1 级时每步毫秒数
  const MIN_TICK = 68;        // 最快速度
  const SPEED_STEP = 12;      // 每升一级减少的毫秒数
  const LEVEL_STEP = 5;       // 每吃几个果实升级
  const BONUS_EVERY = 4;      // 每吃几个普通果实出现金色果实
  const BONUS_LIFE = 8000;    // 金色果实存活时间
  const MAX_SCORES = 20;      // 存储的高分条数
  const MAX_HISTORY = 50;     // 存储的历史对局条数
  const MAX_NAME = 12;

  const SHARED = {
    base: 'https://ntfy.sh',
    defaultTopic: 'neon-snake-board-v1-7a3c9e5d',
    pollMs: 12000,
    snapshotEveryMs: 10 * 60 * 1000,
    maxEntries: 100,
    maxSnapshotEntries: 18,
    maxMessageBytes: 3900,
  };

  const STORE = {
    scores: 'neon-snake.scores.v1',
    history: 'neon-snake.history.v1',
    best: 'neon-snake.best.v1',
    name: 'neon-snake.name.v1',
    muted: 'neon-snake.muted.v1',
    shared: 'neon-snake.shared.v1',
    outbox: 'neon-snake.outbox.v1',
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const KEY_DIRS = {
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
  };

  const COLORS = {
    bg: '#071014',
    lime: '#c6ff4a',
    mint: '#4ef0b8',
    pink: '#ff5c7a',
    gold: '#ffcf5c',
  };

  /* ---------- 工具函数 ---------- */

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad2 = (value) => String(value).padStart(2, '0');
  const uid = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const prefix = sameYear ? '' : `${date.getFullYear()}-`;
    return `${prefix}${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function normalizeName(value) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME);
  }

  const storage = {
    read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        /* 忽略不可用的本地存储 */
      }
    },
  };

  /* ---------- DOM ---------- */

  const dom = {
    canvas: $('game'),
    shell: $('canvasShell'),
    score: $('score'),
    best: $('best'),
    level: $('level'),
    length: $('length'),
    startOverlay: $('startOverlay'),
    pauseOverlay: $('pauseOverlay'),
    overOverlay: $('overOverlay'),
    startBtn: $('startBtn'),
    resumeBtn: $('resumeBtn'),
    restartBtn: $('restartBtn'),
    pauseRestartBtn: $('pauseRestartBtn'),
    saveScoreBtn: $('saveScoreBtn'),
    playerName: $('playerName'),
    saveBlock: $('saveBlock'),
    savedNote: $('savedNote'),
    overTitle: $('overTitle'),
    overEyebrow: $('overEyebrow'),
    overMsg: $('overMsg'),
    finalScore: $('finalScore'),
    recordBadge: $('recordBadge'),
    soundBtn: $('soundBtn'),
    helpBtn: $('helpBtn'),
    clearBtn: $('clearBtn'),
    confirmClearBtn: $('confirmClearBtn'),
    clearModal: $('clearModal'),
    helpModal: $('helpModal'),
    sharedList: $('sharedList'),
    rankList: $('rankList'),
    historyList: $('historyList'),
    emptyState: $('emptyState'),
    emptyText: $('emptyText'),
    recordSummary: $('recordSummary'),
    tabShared: $('tabShared'),
    tabRank: $('tabRank'),
    tabHistory: $('tabHistory'),
    syncPill: $('syncPill'),
    syncText: $('syncText'),
    toast: $('toast'),
    pauseBtn: $('pauseBtn'),
  };

  const ctx = dom.canvas.getContext('2d');

  /* ---------- 状态 ---------- */

  const state = {
    phase: 'idle',          // idle | running | paused | over
    snake: [],
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    bonus: null,
    score: 0,
    best: 0,
    bestAtStart: 0,
    level: 1,
    eaten: 0,
    apples: 0,
    tickMs: BASE_TICK,
    acc: 0,
    particles: [],
    floats: [],
    shake: 0,
    saved: false,
    reason: '',
    lastName: '',
  };

  const view = { size: 0, cell: 0, dpr: 1 };

  const sharedState = {
    topic: '',
    entries: [],
    lastTime: 0,
    syncedAt: 0,
    snapshotAt: 0,
    status: 'connecting',
    error: '',
    running: false,
    again: false,
    timer: 0,
  };

  let activeTab = 'shared';
  let highlightId = null;
  let pendingNoteEntryId = '';
  let toastTimer = 0;
  let swipeStart = null;
  let lastFrame = typeof performance !== 'undefined' ? performance.now() : 0;

  /* ---------- 音效 ---------- */

  const sound = {
    ctx: null,
    muted: storage.read(STORE.muted, false) === true,

    init() {
      if (this.muted) return;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!this.ctx) {
        try {
          this.ctx = new AudioCtor();
        } catch (error) {
          this.ctx = null;
          return;
        }
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    tone(freq, duration = 0.09, type = 'square', volume = 0.045, delay = 0, slideTo = null) {
      if (this.muted) return;
      this.init();
      const ac = this.ctx;
      if (!ac) return;
      try {
        const start = ac.currentTime + delay;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (slideTo) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), start + duration);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + duration + 0.03);
      } catch (error) {
        /* 音效失败不影响游戏 */
      }
    },

    eat() {
      this.tone(520, 0.08, 'square', 0.04);
      this.tone(760, 0.08, 'square', 0.028, 0.045);
    },
    bonus() {
      [660, 880, 1170].forEach((freq, index) => {
        this.tone(freq, 0.1, 'triangle', 0.045, index * 0.065);
      });
    },
    spawn() {
      this.tone(980, 0.07, 'triangle', 0.03);
      this.tone(1260, 0.09, 'triangle', 0.025, 0.06);
    },
    level() {
      [440, 660, 990].forEach((freq, index) => {
        this.tone(freq, 0.12, 'triangle', 0.038, index * 0.08);
      });
    },
    over() {
      this.tone(220, 0.32, 'sawtooth', 0.045, 0, 72);
      this.tone(150, 0.38, 'square', 0.026, 0.12, 52);
    },
    save() {
      this.tone(880, 0.08, 'sine', 0.035);
      this.tone(1320, 0.12, 'sine', 0.028, 0.06);
    },
    start() {
      this.tone(460, 0.08, 'triangle', 0.035);
      this.tone(690, 0.12, 'triangle', 0.035, 0.08);
    },
    toggle() {
      this.muted = !this.muted;
      storage.write(STORE.muted, this.muted);
      if (!this.muted) {
        this.init();
        this.tone(720, 0.08, 'sine', 0.04);
      }
      return this.muted;
    },
  };

  /* ---------- 排行榜数据 ---------- */

  function isValidEntry(entry) {
    return Boolean(
      entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.score === 'number' &&
      Number.isFinite(entry.score) &&
      entry.score >= 0
    );
  }

  function sortScores(list) {
    return list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }

  function loadScores() {
    const raw = storage.read(STORE.scores, []);
    if (!Array.isArray(raw)) return [];
    return sortScores(raw.filter(isValidEntry)).slice(0, MAX_SCORES);
  }

  function loadHistory() {
    const raw = storage.read(STORE.history, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidEntry).slice(0, MAX_HISTORY);
  }

  function loadBest() {
    const stored = Number(storage.read(STORE.best, 0));
    const bestStored = Number.isFinite(stored) && stored > 0 ? stored : 0;
    const scores = loadScores();
    const bestSaved = scores.length ? scores[0].score : 0;
    return Math.max(bestStored, bestSaved);
  }

  function formatClock(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--:--';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  /* ---------- 共享榜数据 ---------- */

  function resolveTopic() {
    try {
      const custom = new URLSearchParams(window.location.search).get('board');
      const clean = String(custom || '').trim();
      if (/^[A-Za-z0-9_-]{3,64}$/.test(clean)) return clean;
    } catch (error) {
      /* 忽略无效参数 */
    }
    return SHARED.defaultTopic;
  }

  function sharedBaseUrl() {
    return `${SHARED.base}/${encodeURIComponent(sharedState.topic)}`;
  }

  function sharedCacheKey() {
    return `${STORE.shared}.${sharedState.topic}`;
  }

  function outboxKey() {
    return `${STORE.outbox}.${sharedState.topic}`;
  }

  function sanitizeSharedEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || id.length > 64) return null;

    const name = normalizeName(raw.name) || '无名玩家';
    const score = Number(raw.score);
    const level = Number(raw.level);
    const length = Number(raw.length);
    const date = typeof raw.date === 'string' ? raw.date : '';

    if (!Number.isFinite(score) || score < 0 || score > 9999999) return null;
    if (!Number.isFinite(level) || level < 1 || level > 999) return null;
    if (!Number.isFinite(length) || length < 1 || length > 999) return null;
    if (!date || Number.isNaN(new Date(date).getTime())) return null;

    return {
      id,
      name,
      score: Math.floor(score),
      level: Math.floor(level),
      length: Math.floor(length),
      date,
    };
  }

  function mergeSharedEntries(list) {
    const map = new Map(sharedState.entries.map((entry) => [entry.id, entry]));
    const source = Array.isArray(list) ? list : [];
    for (const raw of source) {
      const entry = sanitizeSharedEntry(raw);
      if (!entry) continue;
      const existing = map.get(entry.id);
      if (existing && (
        existing.name !== entry.name ||
        existing.score !== entry.score ||
        existing.level !== entry.level ||
        existing.length !== entry.length ||
        existing.date !== entry.date
      )) {
        continue;
      }
      map.set(entry.id, entry);
    }
    sharedState.entries = Array.from(map.values())
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      })
      .slice(0, SHARED.maxEntries);
  }

  function loadSharedCache() {
    const raw = storage.read(sharedCacheKey(), null);
    if (!raw || raw.topic !== sharedState.topic) return;
    if (Array.isArray(raw.entries)) {
      sharedState.entries = [];
      mergeSharedEntries(raw.entries);
    }
    sharedState.lastTime = Number(raw.lastTime) || 0;
    sharedState.syncedAt = Number(raw.syncedAt) || 0;
    sharedState.snapshotAt = Number(raw.snapshotAt) || 0;
  }

  function saveSharedCache() {
    storage.write(sharedCacheKey(), {
      topic: sharedState.topic,
      entries: sharedState.entries,
      lastTime: sharedState.lastTime,
      syncedAt: sharedState.syncedAt,
      snapshotAt: sharedState.snapshotAt,
    });
  }

  function loadOutbox() {
    const raw = storage.read(outboxKey(), []);
    if (!Array.isArray(raw)) return [];
    return raw.map(sanitizeSharedEntry).filter(Boolean).slice(-20);
  }

  function saveOutbox(list) {
    const clean = (Array.isArray(list) ? list : []).slice(-20);
    if (!clean.length) {
      storage.remove(outboxKey());
      return;
    }
    storage.write(outboxKey(), clean);
  }

  function queueSharedEntry(entry) {
    const clean = sanitizeSharedEntry(entry);
    if (!clean) return;
    mergeSharedEntries([clean]);
    const outbox = loadOutbox();
    if (!outbox.some((item) => item.id === clean.id)) outbox.push(clean);
    saveOutbox(outbox);
    saveSharedCache();
  }

  function removeOutboxEntry(id) {
    saveOutbox(loadOutbox().filter((item) => item.id !== id));
  }

  function localEntryIds() {
    const ids = new Set(loadScores().map((entry) => entry.id));
    for (const entry of loadOutbox()) ids.add(entry.id);
    return ids;
  }

  function sharedRank(score) {
    return sharedState.entries.filter((entry) => entry.score > score).length + 1;
  }

  const SYNC_LABELS = {
    connecting: '连接中',
    syncing: '同步中',
    online: '已共享',
    pending: '待同步',
    offline: '离线',
  };

  function setSyncStatus(status, error = '') {
    sharedState.status = status;
    if (error) sharedState.error = error;
    dom.syncText.textContent = SYNC_LABELS[status] || status;
    dom.syncPill.className = `pill pill-button is-${status}`;

    let title = '点击刷新共享榜';
    if (status === 'offline') {
      title = sharedState.error
        ? `共享榜离线：${String(sharedState.error).slice(0, 60)}（点击重试）`
        : '共享榜离线，点击重试';
    } else if (status === 'pending') {
      title = '有成绩等待同步，点击立即重试';
    } else if (status === 'online' && sharedState.syncedAt) {
      title = `上次同步 ${formatClock(sharedState.syncedAt)} · 点击刷新`;
    }
    dom.syncPill.title = title;
    dom.syncPill.setAttribute('aria-label', title);
    updateSummary();
    updateEmptyState();
  }

  function updateSummary() {
    if (!dom.recordSummary) return;
    if (activeTab === 'shared') {
      const pending = loadOutbox().length;
      if (!sharedState.entries.length) {
        dom.recordSummary.textContent = sharedState.status === 'offline'
          ? '共享榜离线 · 等待重连'
          : '暂无共享成绩';
      } else if (pending) {
        dom.recordSummary.textContent = `${sharedState.entries.length} 条 · 待同步 ${pending} 条`;
      } else {
        dom.recordSummary.textContent = `${sharedState.entries.length} 条 · 最高 ${sharedState.entries[0].score}`;
      }
    } else if (activeTab === 'rank') {
      const scores = loadScores();
      dom.recordSummary.textContent = `${scores.length} 条本机成绩 · 最高 ${state.best}`;
    } else {
      dom.recordSummary.textContent = `最近 ${loadHistory().length} 局`;
    }
  }

  function createRankRow(entry, index, options = {}) {
    const row = document.createElement('li');
    row.className = `rank-row rank-${index + 1}`;
    if (entry.id === highlightId) row.classList.add('is-new');
    if (options.pending) row.classList.add('is-pending');
    row.title = `${entry.name} · ${entry.score} 分`;

    const no = document.createElement('span');
    no.className = 'rank-no';
    no.textContent = pad2(index + 1);

    const info = document.createElement('div');
    info.className = 'rank-info';

    const person = document.createElement('div');
    person.className = 'rank-person';
    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = entry.name;
    name.title = entry.name;
    person.append(name);

    if (options.you) {
      const badge = document.createElement('em');
      badge.className = 'you-badge';
      badge.textContent = '你';
      person.append(badge);
    }

    const meta = document.createElement('span');
    meta.className = 'rank-meta';
    meta.textContent = `Lv.${Number(entry.level) || 1} · ${formatDate(entry.date)}`;
    if (options.pending) {
      const flag = document.createElement('span');
      flag.className = 'pending-flag';
      flag.textContent = ' · 待同步';
      meta.append(flag);
    }

    info.append(person, meta);

    const score = document.createElement('span');
    score.className = 'rank-score';
    const strong = document.createElement('strong');
    strong.textContent = entry.score;
    const sub = document.createElement('span');
    sub.textContent = `${Number(entry.length) || '—'} 节`;
    score.append(strong, sub);

    row.append(no, info, score);
    return row;
  }

  function renderSharedList() {
    dom.sharedList.replaceChildren();
    const ownIds = localEntryIds();
    const pendingIds = new Set(loadOutbox().map((entry) => entry.id));
    sharedState.entries.slice(0, 10).forEach((entry, index) => {
      dom.sharedList.append(
        createRankRow(entry, index, {
          you: ownIds.has(entry.id),
          pending: pendingIds.has(entry.id),
        })
      );
    });
  }

  function renderRecords() {
    const scores = loadScores();
    const history = loadHistory();

    state.best = Math.max(loadBest(), state.score);
    dom.best.textContent = state.best;

    dom.rankList.replaceChildren();
    scores.slice(0, 10).forEach((entry, index) => {
      dom.rankList.append(createRankRow(entry, index));
    });

    renderSharedList();

    dom.historyList.replaceChildren();
    history.slice(0, 15).forEach((entry) => {
      const row = document.createElement('li');
      row.className = 'history-row';
      if (entry.id === highlightId) row.classList.add('is-new');

      const info = document.createElement('div');
      info.className = 'history-info';
      const name = document.createElement('span');
      name.className = 'history-name';
      name.textContent = entry.name;
      name.title = entry.name;
      const meta = document.createElement('span');
      meta.className = 'history-meta';
      meta.textContent = `Lv.${Number(entry.level) || 1} · ${formatDate(entry.date)}`;
      info.append(name, meta);

      const score = document.createElement('span');
      score.className = 'history-score';
      score.textContent = entry.score;
      score.title = `${entry.score} 分`;

      row.append(info, score);
      dom.historyList.append(row);
    });

    updateSummary();
    updateEmptyState();
  }

  function updateEmptyState() {
    const counts = {
      shared: sharedState.entries.length,
      rank: loadScores().length,
      history: loadHistory().length,
    };
    const hasRecords = counts[activeTab] > 0;
    dom.emptyState.hidden = hasRecords;
    if (hasRecords) return;

    if (activeTab === 'shared') {
      dom.emptyText.innerHTML = sharedState.status === 'offline'
        ? '共享榜暂时离线<br><span>检查网络后点击右上角状态重试</span>'
        : '共享榜还没有成绩<br><span>保存一局，让所有人看到你</span>';
    } else if (activeTab === 'rank') {
      dom.emptyText.innerHTML = '本机还没有成绩<br><span>开一局，把名字留在这里</span>';
    } else {
      dom.emptyText.innerHTML = '还没有对局记录<br><span>每局结束都会自动记在这里</span>';
    }
  }

  function setTab(tab) {
    activeTab = tab === 'rank' || tab === 'history' ? tab : 'shared';
    const tabs = {
      shared: dom.tabShared,
      rank: dom.tabRank,
      history: dom.tabHistory,
    };

    Object.entries(tabs).forEach(([key, button]) => {
      const selected = key === activeTab;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
    });

    dom.sharedList.hidden = activeTab !== 'shared';
    dom.rankList.hidden = activeTab !== 'rank';
    dom.historyList.hidden = activeTab !== 'history';

    updateSummary();
    updateEmptyState();
  }

  function saveScore(options = {}) {
    if (state.saved || state.score <= 0) return null;

    const typedName = normalizeName(dom.playerName.value);
    const name = typedName || '无名玩家';
    const entry = {
      id: uid(),
      name,
      score: state.score,
      level: state.level,
      length: state.snake.length,
      date: new Date().toISOString(),
    };

    const previous = loadScores();
    const allScores = sortScores(previous.concat(entry));
    const localRank = allScores.findIndex((item) => item.id === entry.id) + 1;

    const scoresSaved = storage.write(STORE.scores, allScores.slice(0, MAX_SCORES));

    const history = loadHistory();
    history.unshift(entry);
    const historySaved = storage.write(STORE.history, history.slice(0, MAX_HISTORY));

    if (typedName) {
      state.lastName = typedName;
      storage.write(STORE.name, typedName);
    }

    state.saved = true;
    highlightId = entry.id;
    queueSharedEntry(entry);
    renderRecords();
    setTab('shared');

    pendingNoteEntryId = entry.id;
    dom.saveBlock.hidden = true;
    dom.savedNote.hidden = false;
    dom.savedNote.className = 'saved-note is-warn';
    dom.savedNote.textContent = `成绩已保存 · 本机第 ${localRank} 名，正在同步共享榜…`;

    if (!scoresSaved || !historySaved) {
      showToast('本地存储不可用，成绩仅在本次会话有效', 'gold');
    } else if (!options.silent) {
      showToast('已保存到本机，正在同步共享榜', 'gold');
      sound.save();
    }

    syncShared(false);
    return entry;
  }

  /* ---------- 共享榜同步 ---------- */

  async function publishShared(payload) {
    const body = JSON.stringify(payload);
    if (new Blob([body]).size > SHARED.maxMessageBytes) {
      throw new Error('共享消息过大');
    }

    const response = await fetch(sharedBaseUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      cache: 'no-store',
      keepalive: true,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }

  async function pullShared(initial) {
    const since = initial || !sharedState.lastTime
      ? 'all'
      : String(Math.max(0, sharedState.lastTime - 1));
    const url = `${sharedBaseUrl()}/json?poll=1&since=${encodeURIComponent(since)}`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) return 0;

    const lines = text.split('\n').filter(Boolean);
    const start = Math.max(0, lines.length - 1200);
    const batch = [];
    let maxTime = sharedState.lastTime;

    for (let i = start; i < lines.length; i += 1) {
      let event;
      try {
        event = JSON.parse(lines[i]);
      } catch (error) {
        continue;
      }

      if (!event || event.event !== 'message' || typeof event.message !== 'string') continue;
      const time = Number(event.time) || 0;
      if (time > maxTime) maxTime = time;
      if (event.message.length > 50000) continue;

      let payload;
      try {
        payload = JSON.parse(event.message);
      } catch (error) {
        continue;
      }
      if (!payload || payload.v !== 1) continue;

      if (payload.type === 'entry' && payload.entry) {
        const entry = sanitizeSharedEntry(payload.entry);
        if (entry) batch.push(entry);
      } else if (payload.type === 'snapshot' && Array.isArray(payload.entries)) {
        for (const raw of payload.entries.slice(0, SHARED.maxSnapshotEntries)) {
          const entry = sanitizeSharedEntry(raw);
          if (entry) batch.push(entry);
        }
      }
    }

    sharedState.lastTime = Math.max(sharedState.lastTime, maxTime);
    if (batch.length) mergeSharedEntries(batch);
    saveSharedCache();
    return batch.length;
  }

  async function flushOutbox() {
    const outbox = loadOutbox();
    if (!outbox.length) return 0;

    let sent = 0;
    for (const entry of outbox) {
      try {
        await publishShared({
          v: 1,
          type: 'entry',
          sentAt: Date.now(),
          entry,
        });
        removeOutboxEntry(entry.id);
        mergeSharedEntries([entry]);
        saveSharedCache();
        sent += 1;
      } catch (error) {
        sharedState.error = error && error.message ? error.message : '网络错误';
        break;
      }
    }
    return sent;
  }

  async function maybePublishSnapshot() {
    if (!sharedState.entries.length) return false;
    if (loadOutbox().length) return false;
    if (Date.now() - sharedState.snapshotAt < SHARED.snapshotEveryMs) return false;

    const entries = sharedState.entries.slice(0, SHARED.maxSnapshotEntries).map((entry) => ({
      id: entry.id,
      name: entry.name,
      score: entry.score,
      level: entry.level,
      length: entry.length,
      date: entry.date,
    }));
    if (entries.length < 3) return false;

    const payload = { v: 1, type: 'snapshot', sentAt: Date.now(), entries };
    let body = JSON.stringify(payload);
    while (new Blob([body]).size > SHARED.maxMessageBytes && entries.length > 3) {
      entries.pop();
      payload.entries = entries;
      body = JSON.stringify(payload);
    }
    if (new Blob([body]).size > SHARED.maxMessageBytes) return false;

    try {
      await publishShared(payload);
      return true;
    } catch (error) {
      sharedState.error = error && error.message ? error.message : '网络错误';
      return false;
    } finally {
      sharedState.snapshotAt = Date.now();
      saveSharedCache();
    }
  }

  function updateSavedNoteAfterSync() {
    if (!pendingNoteEntryId || dom.savedNote.hidden) return;

    const outbox = loadOutbox();
    const pending = outbox.some((entry) => entry.id === pendingNoteEntryId);
    const entry = sharedState.entries.find((item) => item.id === pendingNoteEntryId)
      || outbox.find((item) => item.id === pendingNoteEntryId);
    if (!entry) return;

    if (pending) {
      dom.savedNote.className = 'saved-note is-warn';
      if (sharedState.status === 'offline') {
        dom.savedNote.textContent = '成绩已保存到本机 · 共享榜离线，稍后自动重试';
      } else if (sharedState.status === 'pending') {
        dom.savedNote.textContent = '成绩已保存到本机 · 共享榜待同步，稍后自动重试';
      } else {
        dom.savedNote.textContent = '成绩已保存到本机 · 正在同步共享榜…';
      }
      return;
    }

    const rankIndex = sharedState.entries.findIndex((item) => item.id === entry.id);
    const rank = rankIndex >= 0 ? rankIndex + 1 : sharedRank(entry.score);
    dom.savedNote.className = 'saved-note';
    dom.savedNote.textContent = rank <= 10
      ? `成绩已保存 · 共享榜第 ${rank} 名`
      : `成绩已保存 · 共享榜第 ${rank} 名（仅展示前 10）`;
  }

  async function doSync(initial) {
    if (sharedState.running) {
      sharedState.again = true;
      return;
    }

    sharedState.running = true;
    sharedState.error = '';
    setSyncStatus('syncing');

    try {
      await pullShared(initial);
      await flushOutbox();
      if (!loadOutbox().length) {
        await maybePublishSnapshot();
      }

      sharedState.syncedAt = Date.now();
      saveSharedCache();
      setSyncStatus(loadOutbox().length ? 'pending' : 'online');
      renderRecords();
      updateSavedNoteAfterSync();
    } catch (error) {
      sharedState.error = error && error.message ? error.message : '网络错误';
      saveSharedCache();
      setSyncStatus('offline');
      renderRecords();
      updateSavedNoteAfterSync();
    } finally {
      sharedState.running = false;
      if (sharedState.again) {
        sharedState.again = false;
        window.setTimeout(() => syncShared(false), 300);
      }
    }
  }

  function syncShared(initial = false) {
    return doSync(initial);
  }

  function startSharedPolling() {
    window.clearInterval(sharedState.timer);
    sharedState.timer = window.setInterval(() => {
      if (document.hidden) return;
      if (!navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      syncShared(false);
    }, SHARED.pollMs);
  }

  function initShared() {
    sharedState.topic = resolveTopic();
    loadSharedCache();
    mergeSharedEntries(loadOutbox());
    setSyncStatus(navigator.onLine ? 'connecting' : 'offline');
    startSharedPolling();
  }

  /* ---------- 覆盖层 / 提示 ---------- */

  function syncOverlays() {
    dom.startOverlay.classList.toggle('is-hidden', state.phase !== 'idle');
    dom.pauseOverlay.classList.toggle('is-hidden', state.phase !== 'paused');
    dom.overOverlay.classList.toggle('is-hidden', state.phase !== 'over');

    const paused = state.phase === 'paused';
    dom.pauseBtn.classList.toggle('is-paused', paused);
    dom.pauseBtn.setAttribute(
      'aria-label',
      paused ? '继续游戏' : state.phase === 'idle' ? '开始游戏' : '暂停游戏'
    );
  }

  function showToast(message, tone = '') {
    dom.toast.textContent = message;
    dom.toast.className = `toast is-visible${tone ? ` toast-${tone}` : ''}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      dom.toast.className = 'toast';
    }, 1900);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    dom.toast.className = 'toast';
    dom.toast.textContent = '';
  }

  function bump(element) {
    element.classList.remove('pop');
    void element.offsetWidth;
    element.classList.add('pop');
  }

  function updateHud(animate = false) {
    dom.score.textContent = state.score;
    dom.best.textContent = Math.max(state.best, state.score);
    dom.level.textContent = state.level;
    dom.length.textContent = state.snake.length;
    if (animate) bump(dom.score);
  }

  function updateSoundButton() {
    dom.soundBtn.classList.toggle('is-muted', sound.muted);
    dom.soundBtn.setAttribute('aria-pressed', String(!sound.muted));
    dom.soundBtn.setAttribute('aria-label', sound.muted ? '开启音效' : '关闭音效');
    dom.soundBtn.title = sound.muted ? '开启音效' : '关闭音效';
  }

  /* ---------- 游戏流程 ---------- */

  function freeCells() {
    const taken = new Set();
    for (const segment of state.snake) taken.add(`${segment.x},${segment.y}`);
    if (state.food) taken.add(`${state.food.x},${state.food.y}`);
    if (state.bonus) taken.add(`${state.bonus.x},${state.bonus.y}`);

    const cells = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!taken.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }

  function makeFood() {
    const cells = freeCells();
    if (!cells.length) return null;
    return cells[Math.floor(Math.random() * cells.length)];
  }

  function spawnBonus() {
    if (state.bonus) return;
    const cells = freeCells();
    if (!cells.length) return;
    const cell = cells[Math.floor(Math.random() * cells.length)];
    state.bonus = { x: cell.x, y: cell.y, life: BONUS_LIFE };
    showToast('金色果实出现 · 8 秒内吃掉它', 'gold');
    sound.spawn();
  }

  function resetGame() {
    const centerX = Math.floor(COLS / 2);
    const centerY = Math.floor(ROWS / 2);

    state.snake = [];
    for (let i = 0; i < 4; i += 1) {
      state.snake.push({ x: centerX - i, y: centerY, px: centerX - i, py: centerY });
    }

    state.dir = { x: 1, y: 0 };
    state.queue = [];
    state.food = null;
    state.bonus = null;
    state.score = 0;
    state.level = 1;
    state.eaten = 0;
    state.apples = 0;
    state.tickMs = BASE_TICK;
    state.acc = 0;
    state.particles = [];
    state.floats = [];
    state.shake = 0;
    state.saved = false;
    state.reason = '';
    state.bestAtStart = loadBest();
    state.best = state.bestAtStart;
    highlightId = null;
    pendingNoteEntryId = '';

    state.food = makeFood();

    dom.saveBlock.hidden = false;
    dom.savedNote.hidden = true;
    dom.savedNote.className = 'saved-note';
    dom.playerName.disabled = false;
    dom.saveScoreBtn.disabled = false;
    dom.saveScoreBtn.textContent = '保存';
    dom.playerName.value = state.lastName || '';
    dom.recordBadge.hidden = true;
    dom.pauseBtn.classList.remove('is-paused');

    updateHud(false);
  }

  function startGame() {
    resetGame();
    state.phase = 'running';
    state.acc = 0;
    hideToast();
    lastFrame = performance.now();
    syncOverlays();
    updateHud(false);
    sound.init();
    sound.start();
  }

  function pauseGame() {
    if (state.phase !== 'running') return;
    state.phase = 'paused';
    state.queue = [];
    hideToast();
    syncOverlays();
    sound.tone(300, 0.08, 'triangle', 0.03);
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'running';
    state.acc = 0;
    lastFrame = performance.now();
    syncOverlays();
    sound.tone(540, 0.07, 'triangle', 0.03);
  }

  function togglePause() {
    if (state.phase === 'running') {
      pauseGame();
    } else if (state.phase === 'paused') {
      resumeGame();
    } else if (state.phase === 'idle') {
      startGame();
    }
  }

  function restartGame() {
    if (state.phase === 'over' && !state.saved && state.score > 0) {
      saveScore({ silent: true });
    }
    startGame();
  }

  function endGame(reason) {
    if (state.phase !== 'running') return;

    state.phase = 'over';
    state.reason = reason;
    state.queue = [];
    state.shake = 16;
    hideToast();

    if (state.score > state.best) {
      state.best = state.score;
      storage.write(STORE.best, state.best);
    }
    updateHud(false);

    const head = state.snake[0];
    if (head) {
      burst(head.x + 0.5, head.y + 0.5, [COLORS.lime, COLORS.pink, COLORS.mint, '#ffffff'], 26);
    }

    const deathText = {
      wall: '撞上了墙壁',
      self: '咬到了自己的尾巴',
      win: '棋盘被填满，完美通关',
    }[reason] || '游戏结束';

    dom.overEyebrow.textContent = reason === 'win' ? 'PERFECT' : 'GAME OVER';
    dom.overEyebrow.classList.toggle('danger', reason !== 'win');
    dom.overTitle.textContent = reason === 'win' ? '通关！' : '游戏结束';
    dom.finalScore.textContent = state.score;
    dom.recordBadge.hidden = !(state.score > 0 && state.score > state.bestAtStart);

    if (state.score > 0) {
      const rank = sharedRank(state.score);
      dom.overMsg.textContent = `${deathText} · 长度 ${state.snake.length} · 等级 ${state.level} · 共享榜预计第 ${rank} 名`;
      dom.saveBlock.hidden = false;
      dom.savedNote.hidden = true;
      dom.savedNote.className = 'saved-note';
      dom.playerName.value = state.lastName || '';
      dom.playerName.disabled = false;
      dom.saveScoreBtn.disabled = false;
      dom.saveScoreBtn.textContent = '保存';
      pendingNoteEntryId = '';
    } else {
      dom.overMsg.textContent = `${deathText} · 这次没得分，再来一局吧`;
      dom.saveBlock.hidden = true;
      dom.savedNote.hidden = true;
      dom.savedNote.className = 'saved-note';
    }

    syncOverlays();
    sound.over();
  }

  function addScore(points, gridX, gridY, label, color) {
    state.score += points;

    if (state.score > state.best) {
      state.best = state.score;
      storage.write(STORE.best, state.best);
    }

    dom.score.textContent = state.score;
    dom.best.textContent = Math.max(state.best, state.score);
    bump(dom.score);

    state.floats.push({
      x: gridX + 0.5,
      y: gridY + 0.35,
      text: label,
      age: 0,
      life: 950,
      color,
    });
  }

  function burst(gridX, gridY, colors, count = 14) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 4.2;
      const life = 320 + Math.random() * 480;
      state.particles.push({
        x: gridX,
        y: gridY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 3.2,
        life,
        maxLife: life,
        size: 0.035 + Math.random() * 0.065,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function step() {
    if (state.queue.length) {
      const next = state.queue.shift();
      if (!(next.x === -state.dir.x && next.y === -state.dir.y)) {
        state.dir = next;
      }
    }

    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      endGame('wall');
      return;
    }

    const eatsFood = Boolean(state.food && state.food.x === nx && state.food.y === ny);
    const eatsBonus = Boolean(state.bonus && state.bonus.x === nx && state.bonus.y === ny);
    const grow = eatsBonus ? 2 : eatsFood ? 1 : 0;

    const collisionLimit = state.snake.length - (grow ? 0 : 1);
    for (let i = 0; i < collisionLimit; i += 1) {
      if (state.snake[i].x === nx && state.snake[i].y === ny) {
        endGame('self');
        return;
      }
    }

    const oldSnake = state.snake;
    const nextSnake = [{ x: nx, y: ny, px: oldSnake[0].x, py: oldSnake[0].y }];

    for (let i = 1; i < oldSnake.length; i += 1) {
      const ahead = oldSnake[i - 1];
      const segment = oldSnake[i];
      nextSnake.push({ x: ahead.x, y: ahead.y, px: segment.x, py: segment.y });
    }

    for (let i = 0; i < grow; i += 1) {
      const tail = oldSnake[oldSnake.length - 1];
      nextSnake.push({ x: tail.x, y: tail.y, px: tail.x, py: tail.y });
    }

    state.snake = nextSnake;

    if (eatsFood) {
      state.food = null;
      state.eaten += 1;
      state.apples += 1;
      addScore(10, nx, ny, '+10', '#ff8aa1');
      burst(nx + 0.5, ny + 0.5, [COLORS.pink, '#ffb3c4', '#ffffff', COLORS.lime], 16);
      sound.eat();

      if (state.apples % BONUS_EVERY === 0) {
        spawnBonus();
      }

      state.food = makeFood();
      if (!state.food) {
        endGame('win');
        return;
      }
    }

    if (eatsBonus) {
      state.bonus = null;
      state.eaten += 1;
      addScore(50, nx, ny, '+50', COLORS.gold);
      burst(nx + 0.5, ny + 0.5, [COLORS.gold, '#fff3c4', '#ffb347', '#ffffff'], 30);
      sound.bonus();
    }

    const nextLevel = 1 + Math.floor(state.eaten / LEVEL_STEP);
    if (nextLevel > state.level) {
      state.level = nextLevel;
      state.tickMs = Math.max(MIN_TICK, BASE_TICK - (state.level - 1) * SPEED_STEP);
      bump(dom.level);
      sound.level();
      state.floats.push({
        x: head.x + 0.5,
        y: head.y - 0.15,
        text: `LEVEL ${state.level}`,
        age: 0,
        life: 1200,
        color: COLORS.lime,
      });
      showToast(`升级！LEVEL ${state.level} · 速度提升`, 'gold');
    }

    updateHud(false);
    if (grow) bump(dom.length);
  }

  function setDirection(name) {
    const dir = DIRS[name];
    if (!dir) return false;
    if (state.phase === 'over') return false;

    if (state.phase === 'paused') resumeGame();
    if (state.phase === 'idle') startGame();

    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (dir.x === -last.x && dir.y === -last.y) return false;
    if (dir.x === last.x && dir.y === last.y) return false;
    if (state.queue.length >= 2) return false;

    state.queue.push(dir);
    return true;
  }

  /* ---------- 弹窗 ---------- */

  function openModal(element) {
    if (state.phase === 'running') pauseGame();
    element.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModals() {
    dom.clearModal.hidden = true;
    dom.helpModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* ---------- 输入 ---------- */

  function bindEvents() {
    dom.startBtn.addEventListener('click', () => {
      sound.init();
      startGame();
    });

    dom.resumeBtn.addEventListener('click', resumeGame);

    dom.pauseRestartBtn.addEventListener('click', () => {
      sound.init();
      startGame();
    });

    dom.restartBtn.addEventListener('click', () => {
      sound.init();
      restartGame();
    });

    dom.saveScoreBtn.addEventListener('click', () => {
      sound.init();
      saveScore();
    });

    dom.playerName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveScore();
      }
    });

    dom.soundBtn.addEventListener('click', () => {
      const muted = sound.toggle();
      updateSoundButton();
      showToast(muted ? '音效已关闭' : '音效已开启');
    });

    dom.helpBtn.addEventListener('click', () => {
      sound.init();
      openModal(dom.helpModal);
    });

    dom.clearBtn.addEventListener('click', () => {
      openModal(dom.clearModal);
    });

    dom.confirmClearBtn.addEventListener('click', () => {
      storage.remove(STORE.scores);
      storage.remove(STORE.history);
      storage.remove(STORE.best);
      storage.remove(outboxKey());
      highlightId = null;
      pendingNoteEntryId = '';
      state.best = 0;
      renderRecords();
      updateHud(false);
      if (state.phase === 'over' && state.saved) {
        dom.saveBlock.hidden = true;
        dom.savedNote.hidden = false;
        dom.savedNote.className = 'saved-note is-warn';
        dom.savedNote.textContent = '本机记录已清空 · 共享榜成绩仍保留';
        dom.recordBadge.hidden = true;
      }
      closeModals();
      showToast('本机记录已清空 · 共享榜保留');
    });

    $$('.modal [data-close]').forEach((element) => {
      element.addEventListener('click', closeModals);
    });

    dom.tabShared.addEventListener('click', () => setTab('shared'));
    dom.tabRank.addEventListener('click', () => setTab('rank'));
    dom.tabHistory.addEventListener('click', () => setTab('history'));

    dom.syncPill.addEventListener('click', () => {
      showToast('正在刷新共享榜…');
      syncShared(true);
    });

    $$('.dpad-btn[data-dir]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        sound.init();
        setDirection(button.dataset.dir);
      });
    });

    dom.pauseBtn.addEventListener('click', () => {
      sound.init();
      togglePause();
    });

    window.addEventListener('keydown', (event) => {
      const modalOpen = !dom.clearModal.hidden || !dom.helpModal.hidden;
      if (modalOpen) {
        if (event.key === 'Escape') closeModals();
        return;
      }

      if (event.isComposing) return;

      const tag = (event.target && event.target.tagName ? event.target.tagName : '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const key = event.key;
      const isControl = tag === 'button' || tag === 'a' || tag === 'select';
      if (isControl && (key === 'Enter' || ((key === ' ' || event.code === 'Space') && state.phase === 'idle'))) {
        return;
      }

      const dir = KEY_DIRS[key] || KEY_DIRS[key.toLowerCase()];

      if (dir) {
        event.preventDefault();
        sound.init();
        setDirection(dir);
        return;
      }

      if (key === ' ' || event.code === 'Space') {
        event.preventDefault();
        sound.init();
        togglePause();
        return;
      }

      if (key === 'p' || key === 'P') {
        event.preventDefault();
        togglePause();
        return;
      }

      if (key === 'Enter') {
        event.preventDefault();
        sound.init();
        if (state.phase === 'idle') {
          startGame();
        } else if (state.phase === 'over') {
          if (!state.saved && state.score > 0) saveScore();
          else if (state.saved) restartGame();
        }
        return;
      }

      if (key === 'm' || key === 'M') {
        const muted = sound.toggle();
        updateSoundButton();
        showToast(muted ? '音效已关闭' : '音效已开启');
        return;
      }

      if (key === 'Escape' && state.phase === 'running') {
        pauseGame();
      }
    });

    dom.shell.addEventListener('pointerdown', (event) => {
      if (state.phase !== 'running') return;
      swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    });

    window.addEventListener('pointerup', (event) => {
      if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.hypot(dx, dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        setDirection(dx > 0 ? 'right' : 'left');
      } else {
        setDirection(dy > 0 ? 'down' : 'up');
      }
    });

    window.addEventListener('pointercancel', () => {
      swipeStart = null;
    });

    window.addEventListener('blur', () => {
      if (state.phase === 'running') pauseGame();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.phase === 'running') pauseGame();
    });

    window.addEventListener('pagehide', () => {
      if (state.phase === 'over' && !state.saved && state.score > 0) {
        saveScore({ silent: true });
      }
    });

    window.addEventListener('online', () => {
      setSyncStatus('connecting');
      syncShared(true);
    });

    window.addEventListener('offline', () => {
      setSyncStatus('offline');
    });

    window.addEventListener('focus', () => {
      if (!document.hidden && navigator.onLine) syncShared(false);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) syncShared(false);
    });

    window.addEventListener('resize', resizeCanvas);

    window.addEventListener('storage', (event) => {
      if (event.key && event.key.indexOf('neon-snake.') === 0) {
        renderRecords();
      }
    });
  }

  /* ---------- 画布 ---------- */

  function resizeCanvas() {
    const size = Math.max(1, Math.floor(dom.shell.clientWidth));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size === view.size && dpr === view.dpr) return;

    view.size = size;
    view.dpr = dpr;
    view.cell = size / COLS;
    dom.canvas.width = Math.round(size * dpr);
    dom.canvas.height = Math.round(size * dpr);
  }

  function roundRect(x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBoard() {
    const { size, cell } = view;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(
      size * 0.5, size * 0.44, 0,
      size * 0.5, size * 0.5, size * 0.72
    );
    glow.addColorStop(0, 'rgba(34, 92, 69, 0.38)');
    glow.addColorStop(0.55, 'rgba(10, 32, 27, 0.16)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.beginPath();
    for (let i = 1; i < COLS; i += 1) {
      const p = i * cell;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.strokeStyle = 'rgba(130, 255, 190, 0.038)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 4; i < COLS; i += 4) {
      const p = i * cell;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.strokeStyle = 'rgba(150, 255, 195, 0.062)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(198, 255, 74, 0.09)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  function drawFood(time) {
    if (!state.food) return;
    const { cell } = view;
    const x = (state.food.x + 0.5) * cell;
    const y = (state.food.y + 0.5) * cell;
    const pulse = 1 + Math.sin(time / 260) * 0.07;
    const radius = cell * 0.3 * pulse;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.95);
    glow.addColorStop(0, 'rgba(255, 92, 122, 0.34)');
    glow.addColorStop(0.55, 'rgba(255, 92, 122, 0.1)');
    glow.addColorStop(1, 'rgba(255, 92, 122, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.95, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(255, 92, 122, 0.9)';
    ctx.shadowBlur = cell * 0.5;
    const body = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.35, radius * 0.08,
      x, y, radius
    );
    body.addColorStop(0, '#ffc0cd');
    body.addColorStop(0.42, '#ff6d8a');
    body.addColorStop(1, '#d72b54');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x + radius * 0.22, y - radius * 0.9);
    ctx.rotate(-0.55);
    ctx.fillStyle = '#8df06a';
    ctx.beginPath();
    ctx.ellipse(0, 0, cell * 0.15, cell * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(x - radius * 0.34, y - radius * 0.32, cell * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStar(x, y, spikes, outer, inner, rotation) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = rotation + (Math.PI / spikes) * i - Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawBonus(time) {
    if (!state.bonus) return;
    const { cell } = view;
    const x = (state.bonus.x + 0.5) * cell;
    const y = (state.bonus.y + 0.5) * cell;
    const remaining = clamp(state.bonus.life / BONUS_LIFE, 0, 1);
    const pulse = 1 + Math.sin(time / 170) * 0.09;
    const radius = cell * 0.29 * pulse;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 1.05);
    glow.addColorStop(0, 'rgba(255, 207, 92, 0.5)');
    glow.addColorStop(0.5, 'rgba(255, 175, 50, 0.16)');
    glow.addColorStop(1, 'rgba(255, 175, 50, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, cell * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(255, 207, 92, 0.95)';
    ctx.shadowBlur = cell * 0.7;
    const body = ctx.createRadialGradient(x, y - radius * 0.2, radius * 0.05, x, y, radius * 1.2);
    body.addColorStop(0, '#fff7d6');
    body.addColorStop(0.5, '#ffdf86');
    body.addColorStop(1, '#ffb52e');
    ctx.fillStyle = body;
    drawStar(x, y, 5, radius * 1.15, radius * 0.48, time / 820);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = remaining < 0.25 ? 'rgba(255, 110, 110, 0.92)' : 'rgba(255, 226, 150, 0.82)';
    ctx.lineWidth = Math.max(1.5, cell * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
    ctx.stroke();
  }

  function drawParticles() {
    const { cell } = view;
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      const size = Math.max(1.2, particle.size * cell);
      ctx.fillRect(particle.x * cell - size / 2, particle.y * cell - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function drawSnake(time) {
    if (!state.snake.length) return;
    const { cell } = view;

    const progress = state.phase === 'running' || state.phase === 'paused'
      ? clamp(state.acc / state.tickMs, 0, 1)
      : 1;

    const points = state.snake.map((segment) => ({
      x: (lerp(segment.px, segment.x, progress) + 0.5) * cell,
      y: (lerp(segment.py, segment.y, progress) + 0.5) * cell,
    }));

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    ctx.strokeStyle = 'rgba(2, 12, 9, 0.92)';
    ctx.lineWidth = cell * 0.92;
    ctx.stroke();

    const head = points[0];
    const tail = points[points.length - 1];
    let gradient;
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < 2) {
      gradient = ctx.createLinearGradient(head.x, head.y - cell, head.x, head.y + cell);
    } else {
      gradient = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    }
    gradient.addColorStop(0, '#ddff7c');
    gradient.addColorStop(0.32, '#aaf24d');
    gradient.addColorStop(0.72, '#3de0a2');
    gradient.addColorStop(1, '#1fb79a');

    ctx.save();
    ctx.shadowColor = 'rgba(170, 255, 90, 0.38)';
    ctx.shadowBlur = cell * 0.75;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = cell * 0.72;
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.17)';
    ctx.lineWidth = cell * 0.16;
    ctx.stroke();

    const headX = head.x;
    const headY = head.y;
    ctx.save();
    ctx.shadowColor = 'rgba(200, 255, 100, 0.55)';
    ctx.shadowBlur = cell * 0.55;
    const headFill = ctx.createRadialGradient(
      headX - cell * 0.11, headY - cell * 0.12, cell * 0.03,
      headX, headY, cell * 0.45
    );
    headFill.addColorStop(0, '#f2ffbc');
    headFill.addColorStop(0.58, '#c9ff55');
    headFill.addColorStop(1, '#7ce23e');
    ctx.fillStyle = headFill;
    ctx.beginPath();
    ctx.arc(headX, headY, cell * 0.43, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const dir = state.dir;
    const perpX = -dir.y;
    const perpY = dir.x;
    const eyeBaseX = headX + dir.x * cell * 0.1;
    const eyeBaseY = headY + dir.y * cell * 0.1;

    [-1, 1].forEach((side) => {
      const eyeX = eyeBaseX + perpX * cell * 0.165 * side;
      const eyeY = eyeBaseY + perpY * cell * 0.165 * side;
      ctx.fillStyle = '#0a1a0e';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, cell * 0.092, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(eyeX - cell * 0.026, eyeY - cell * 0.026, cell * 0.031, 0, Math.PI * 2);
      ctx.fill();
    });

    if (state.phase === 'running') {
      const flick = Math.sin(time / 190);
      if (flick > 0.72) {
        const tongueStartX = headX + dir.x * cell * 0.38;
        const tongueStartY = headY + dir.y * cell * 0.38;
        const tongueEndX = headX + dir.x * cell * 0.62;
        const tongueEndY = headY + dir.y * cell * 0.62;
        ctx.strokeStyle = 'rgba(255, 92, 122, 0.85)';
        ctx.lineWidth = Math.max(1, cell * 0.045);
        ctx.beginPath();
        ctx.moveTo(tongueStartX, tongueStartY);
        ctx.lineTo(tongueEndX, tongueEndY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tongueEndX, tongueEndY);
        ctx.lineTo(tongueEndX + perpX * cell * 0.08, tongueEndY + perpY * cell * 0.08);
        ctx.moveTo(tongueEndX, tongueEndY);
        ctx.lineTo(tongueEndX - perpX * cell * 0.08, tongueEndY - perpY * cell * 0.08);
        ctx.stroke();
      }
    }
  }

  function drawFloats() {
    const { cell } = view;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const float of state.floats) {
      const progress = float.age / float.life;
      ctx.globalAlpha = clamp(1 - progress, 0, 1);
      ctx.fillStyle = float.color;
      ctx.font = `700 ${Math.max(11, cell * 0.5)}px "Bahnschrift", "Consolas", monospace`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 5;
      ctx.fillText(float.text, float.x * cell, (float.y - progress * 1.5) * cell);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function draw(time) {
    if (!view.size) return;
    const { size, dpr } = view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    if (state.shake > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * state.shake,
        (Math.random() - 0.5) * state.shake
      );
    }
    drawBoard();
    drawFood(time);
    drawBonus(time);
    drawParticles();
    drawSnake(time);
    drawFloats();
    ctx.restore();
  }

  function updateEffects(dt) {
    if (state.phase !== 'paused') {
      for (const particle of state.particles) {
        particle.life -= dt;
        particle.x += (particle.vx * dt) / 1000;
        particle.y += (particle.vy * dt) / 1000;
        particle.vy += (particle.gravity * dt) / 1000;
        particle.vx *= 0.996;
      }
      state.particles = state.particles.filter((particle) => particle.life > 0);

      for (const float of state.floats) float.age += dt;
      state.floats = state.floats.filter((float) => float.age < float.life);

      state.shake *= Math.pow(0.86, dt / 16.7);
      if (state.shake < 0.15) state.shake = 0;

      if (state.phase === 'running' && state.bonus) {
        state.bonus.life -= dt;
        if (state.bonus.life <= 0) {
          burst(
            state.bonus.x + 0.5,
            state.bonus.y + 0.5,
            [COLORS.gold, '#ff9f43', '#ffffff'],
            10
          );
          state.bonus = null;
          showToast('金色果实消失了');
        }
      }
    }
  }

  /* ---------- 主循环 ---------- */

  function frame(now) {
    window.requestAnimationFrame(frame);

    const dt = Math.min(now - lastFrame, 110);
    lastFrame = now;

    if (state.phase === 'running') {
      state.acc += dt;
      let guard = 0;
      while (state.acc >= state.tickMs && state.phase === 'running' && guard < 5) {
        state.acc -= state.tickMs;
        step();
        guard += 1;
      }
    }

    updateEffects(dt);
    draw(now);
  }

  /* ---------- 初始化 ---------- */

  function init() {
    const savedName = storage.read(STORE.name, '');
    state.lastName = typeof savedName === 'string' ? normalizeName(savedName) : '';

    state.best = loadBest();
    initShared();
    resetGame();
    updateSoundButton();
    renderRecords();
    setTab('shared');
    bindEvents();
    resizeCanvas();
    syncOverlays();

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(resizeCanvas);
      observer.observe(dom.shell);
    }

    window.requestAnimationFrame(frame);

    if (navigator.onLine) {
      syncShared(true);
      window.setTimeout(() => syncShared(false), 3000);
    } else {
      setSyncStatus('offline');
    }

    if (new URLSearchParams(window.location.search).has('debug')) {
      window.__snakeDebug = {
        snapshot() {
          return {
            phase: state.phase,
            score: state.score,
            best: state.best,
            level: state.level,
            tickMs: state.tickMs,
            acc: state.acc,
            saved: state.saved,
            snake: state.snake.map((segment) => ({ x: segment.x, y: segment.y })),
            food: state.food ? { x: state.food.x, y: state.food.y } : null,
            bonus: state.bonus ? { x: state.bonus.x, y: state.bonus.y, life: state.bonus.life } : null,
            shared: {
              status: sharedState.status,
              topic: sharedState.topic,
              count: sharedState.entries.length,
              outbox: loadOutbox().length,
              syncedAt: sharedState.syncedAt,
              top: sharedState.entries.slice(0, 5).map((entry) => ({
                name: entry.name,
                score: entry.score,
                level: entry.level,
                length: entry.length,
              })),
            },
          };
        },
        setDirection,
        start: startGame,
        end: endGame,
        save: () => saveScore({ silent: true }),
        syncShared: () => syncShared(true),
      };
    }
  }

  init();
})();
