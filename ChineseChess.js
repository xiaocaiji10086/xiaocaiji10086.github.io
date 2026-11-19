/* ============================================================
   Chinese Chess — rules, AI, online rooms, canvas UI
   Pure front-end. No external dependencies.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- 常量 ---------------- */

  const ROWS = 10;
  const COLS = 9;
  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const MARGIN = 0.7;
  const STEP = 1;
  const BOARD_W = COLS - 1 + MARGIN * 2;
  const BOARD_H = ROWS - 1 + MARGIN * 2;
  const RELAY_MQTT = 'wss://broker.emqx.io:8084/mqtt';
  const TOPIC_PREFIX = 'chinesechess/room/';
  const MATE = 1000000;

  const STORE = {
    puzzles: 'chinese-chess.puzzles.v1',
    name: 'chinese-chess.name.v1',
    muted: 'chinese-chess.muted.v1',
    client: 'chinese-chess.client.v1',
  };

  const PIECE_NAMES = {
    K: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', e: '象', h: '马', r: '车', c: '炮', p: '卒',
    N: '马', n: '马', B: '相', b: '象',
  };

  const PIECE_VALUES = { k: 100000, r: 900, c: 450, h: 400, a: 200, e: 200, p: 100 };

  const LEVELS = {
    easy: { name: '简单', depth: 1, time: 180, random: 0.38, note: '简单：只看一步，常常会漏看吃子。' },
    normal: { name: '一般', depth: 3, time: 650, random: 0.06, note: '一般：搜索 3 层，均衡稳健，适合休闲对局。' },
    hard: { name: '困难', depth: 4, time: 1100, random: 0, note: '困难：搜索 4 层，重视子力与攻势。' },
    hell: { name: '地狱', depth: 6, time: 2000, random: 0, note: '地狱：迭代加深，尽量算到你没脾气。' },
  };

  const PUZZLES = [
    {
      id: 'p1',
      name: '双车压境',
      subtitle: '双车封锁九宫，先逼将再杀',
      diff: '入门',
      fen: '3k5/4a4/9/9/9/9/9/R7R/9/4K4 w',
      ai: 'easy',
      hint: '把一辆车压到黑将身侧，另一辆车控制退路。',
    },
    {
      id: 'p2',
      name: '马炮兵临',
      subtitle: '马炮配合，兵临城下',
      diff: '进阶',
      fen: '3aka3/9/4e4/9/9/4P4/4H4/2C6/9/4K4 w',
      ai: 'normal',
      hint: '马控将门，炮借兵势，先逼黑将离开中路。',
    },
    {
      id: 'p3',
      name: '车炮夹击',
      subtitle: '一车一炮，左右呼应',
      diff: '进阶',
      fen: '2ek2e2/4a4/9/9/9/9/9/R3C4/9/4K4 w',
      ai: 'normal',
      hint: '车占肋道，炮借将门，注意别让黑象飞中。',
    },
    {
      id: 'p4',
      name: '三兵破阵',
      subtitle: '三兵过河，车在后压阵',
      diff: '困难',
      fen: '3aka3/9/2e3e2/9/2P1P1P2/9/9/9/9/R3K4 w',
      ai: 'hard',
      hint: '三兵齐进，先破士象，再用车收口。',
    },
    {
      id: 'p5',
      name: '三子归边',
      subtitle: '车马炮三子归边，围攻将门',
      diff: '大师',
      fen: '3aka3/9/2e3e2/9/9/9/9/R2HC4/9/4K4 w',
      ai: 'hard',
      hint: '车马炮各司其职：车控肋，马挂角，炮镇中。',
    },
  ];

  const OTHER = { r: 'b', b: 'r' };

  /* ---------------- 工具 ---------------- */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = (n) => String(n).padStart(2, '0');
  const now = () => performance.now();
  const other = (side) => OTHER[side];
  const isRed = (piece) => Boolean(piece) && piece >= 'A' && piece <= 'Z';
  const sideOf = (piece) => (isRed(piece) ? 'r' : 'b');
  const typeOf = (piece) => {
    const type = String(piece || '').toLowerCase();
    if (type === 'n') return 'h';
    if (type === 'b') return 'e';
    return type;
  };
  const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
  const inPalace = (x, y, side) => (
    x >= 3 && x <= 5 && (side === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2)
  );
  const ownSide = (y, side) => (side === 'r' ? y >= 5 : y <= 4);

  const safeGet = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  };

  const safeSet = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function chineseNum(n) {
    return ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][n] || String(n);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------------- 棋局状态 ---------------- */

  const game = {
    mode: 'menu',          // menu | ai | puzzle | online
    phase: 'idle',         // idle | playing | thinking | over
    board: [],
    turn: 'r',
    playerSide: 'r',
    selected: null,
    legal: [],
    lastMove: null,
    history: [],
    log: [],
    captured: { r: [], b: [] },
    result: null,
    check: false,
    flipped: false,
    aiLevel: 'normal',
    puzzleIndex: 0,
    puzzleFen: '',
    aiToken: 0,
    hintMove: null,
    hintText: '',
  };

  const online = {
    active: false,
    role: null,            // host | guest
    code: '',
    name: '',
    clientId: '',
    hostId: '',
    hostName: '',
    guestId: '',
    guestName: '',
    seq: 0,
    joined: false,
    polling: false,
    ws: null,
    mqtt: null,
    outbox: [],
    wsReady: false,
    lastTime: 0,
    lastStateAt: 0,
    lastGuestSeen: 0,
    pollTimer: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    pingTimer: null,
    joinTimer: null,
    activeTimer: null,
    catchupTimer: null,
    syncTimers: [],
    joinRetryTimer: null,
    movePending: false,
    pendingMove: null,
    status: 'idle',
    error: '',
  };

  /* ---------------- DOM ---------------- */

  const dom = {
    canvas: $('boardCanvas'),
    boardFrame: $('boardFrame'),
    boardOverlay: $('boardOverlay'),
    resultKicker: $('resultKicker'),
    resultTitle: $('resultTitle'),
    resultText: $('resultText'),
    resultActions: $('resultActions'),
    topSideTag: $('topSideTag'),
    bottomSideTag: $('bottomSideTag'),
    topSideState: $('topSideState'),
    bottomSideState: $('bottomSideState'),
    lastMoveText: $('lastMoveText'),
    checkFlag: $('checkFlag'),
    thinking: $('thinking'),
    thinkingText: $('thinkingText'),

    connectionPill: $('connectionPill'),
    connectionText: $('connectionText'),
    soundBtn: $('soundBtn'),
    helpBtn: $('helpBtn'),
    helpModal: $('helpModal'),

    panelKicker: $('panelKicker'),
    panelTitle: $('panelTitle'),
    statusPill: $('statusPill'),
    statusPillText: $('statusPillText'),
    footMode: $('footMode'),

    menuPanel: $('menuPanel'),
    aiPanel: $('aiPanel'),
    onlinePanel: $('onlinePanel'),
    puzzlePanel: $('puzzlePanel'),
    gamePanel: $('gamePanel'),

    levelGrid: $('levelGrid'),
    levelNote: $('levelNote'),
    aiStartBtn: $('aiStartBtn'),

    onlineSetup: $('onlineSetup'),
    onlineRoom: $('onlineRoom'),
    onlineName: $('onlineName'),
    roomInput: $('roomInput'),
    createRoomBtn: $('createRoomBtn'),
    joinRoomBtn: $('joinRoomBtn'),
    onlineError: $('onlineError'),
    roomCode: $('roomCode'),
    copyCodeBtn: $('copyCodeBtn'),
    copyLinkBtn: $('copyLinkBtn'),
    roomStatusText: $('roomStatusText'),
    roomPlayers: $('roomPlayers'),
    leaveRoomBtn: $('leaveRoomBtn'),
    createPane: $('createPane'),
    joinPane: $('joinPane'),

    puzzleList: $('puzzleList'),

    gameRoomBar: $('gameRoomBar'),
    gameRoomCode: $('gameRoomCode'),
    gameOpponent: $('gameOpponent'),
    gameCopyCode: $('gameCopyCode'),
    turnCard: $('turnCard'),
    turnDisc: $('turnDisc'),
    turnLabel: $('turnLabel'),
    turnStrong: $('turnStrong'),
    turnSide: $('turnSide'),
    gameStatusText: $('gameStatusText'),
    capturedByRed: $('capturedByRed'),
    capturedByBlack: $('capturedByBlack'),
    moveCount: $('moveCount'),
    moveList: $('moveList'),
    gameActions: $('gameActions'),
    undoBtn: $('undoBtn'),
    hintBtn: $('hintBtn'),
    resignBtn: $('resignBtn'),
    backBtn: $('backBtn'),
    onlineGameActions: $('onlineGameActions'),
    onlineResignBtn: $('onlineResignBtn'),
    onlineLeaveBtn: $('onlineLeaveBtn'),

    toast: $('toast'),
    soundWave: $('soundWave'),
  };

  const ctx = dom.canvas.getContext('2d');
  const radar = null;
  let toastTimer = 0;
  let renderQueued = false;
  let woodCanvas = null;
  let boardScale = 1;

  /* ---------------- 象棋规则 ---------------- */

  function parseFen(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== ROWS) throw new Error('FEN 行数不正确');
    const board = rows.map((row) => {
      const line = [];
      for (const ch of row) {
        if (/\d/.test(ch)) {
          const n = Number(ch);
          for (let i = 0; i < n; i += 1) line.push(null);
        } else {
          line.push(ch);
        }
      }
      if (line.length !== COLS) throw new Error('FEN 列数不正确');
      return line;
    });
    return { board, turn: parts[1] === 'b' ? 'b' : 'r' };
  }

  function toFen(board, turn) {
    const rows = board.map((line) => {
      let out = '';
      let empty = 0;
      for (const piece of line) {
        if (!piece) {
          empty += 1;
        } else {
          if (empty) { out += empty; empty = 0; }
          out += piece;
        }
      }
      if (empty) out += empty;
      return out;
    });
    return `${rows.join('/')} ${turn === 'b' ? 'b' : 'w'}`;
  }

  function findKing(board, side) {
    const king = side === 'r' ? 'K' : 'k';
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (board[y][x] === king) return { x, y };
      }
    }
    return null;
  }

  function pushTarget(list, board, side, x, y) {
    if (!inside(x, y)) return false;
    const target = board[y][x];
    if (!target) {
      list.push({ x, y });
      return true;
    }
    if (sideOf(target) !== side) list.push({ x, y });
    return false;
  }

  function pseudoMovesFrom(board, x, y) {
    const piece = board[y][x];
    if (!piece) return [];
    const side = sideOf(piece);
    const type = typeOf(piece);
    const moves = [];
    const add = (tx, ty) => pushTarget(moves, board, side, tx, ty);

    if (type === 'r' || type === 'c') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let tx = x + dx;
        let ty = y + dy;
        let screen = false;
        while (inside(tx, ty)) {
          const target = board[ty][tx];
          if (type === 'r') {
            if (!target) {
              moves.push({ x: tx, y: ty });
            } else {
              if (sideOf(target) !== side) moves.push({ x: tx, y: ty });
              break;
            }
          } else if (!screen) {
            if (!target) {
              moves.push({ x: tx, y: ty });
            } else {
              screen = true;
            }
          } else if (target) {
            if (sideOf(target) !== side) moves.push({ x: tx, y: ty });
            break;
          }
          tx += dx;
          ty += dy;
        }
      }
      return moves;
    }

    if (type === 'h') {
      const jumps = [
        [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
        [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
      ];
      for (const [dx, dy, lx, ly] of jumps) {
        const legX = x + lx;
        const legY = y + ly;
        if (!inside(legX, legY) || board[legY][legX]) continue;
        add(x + dx, y + dy);
      }
      return moves;
    }

    if (type === 'e') {
      for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const tx = x + dx;
        const ty = y + dy;
        if (!inside(tx, ty)) continue;
        if (!ownSide(ty, side)) continue;
        const eyeX = x + dx / 2;
        const eyeY = y + dy / 2;
        if (board[eyeY][eyeX]) continue;
        add(tx, ty);
      }
      return moves;
    }

    if (type === 'a') {
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const tx = x + dx;
        const ty = y + dy;
        if (inPalace(tx, ty, side)) add(tx, ty);
      }
      return moves;
    }

    if (type === 'k') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tx = x + dx;
        const ty = y + dy;
        if (inPalace(tx, ty, side)) add(tx, ty);
      }
      return moves;
    }

    if (type === 'p') {
      const forward = side === 'r' ? -1 : 1;
      add(x, y + forward);
      const crossed = side === 'r' ? y <= 4 : y >= 5;
      if (crossed) {
        add(x - 1, y);
        add(x + 1, y);
      }
      return moves;
    }

    return moves;
  }

  function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = board[y][x];
        if (!piece || sideOf(piece) === side) continue;
        const attacks = pseudoMovesFrom(board, x, y);
        if (attacks.some((m) => m.x === king.x && m.y === king.y)) return true;
      }
    }

    // 白脸将 / 帅将照面
    const redKing = findKing(board, 'r');
    const blackKing = findKing(board, 'b');
    if (redKing && blackKing && redKing.x === blackKing.x) {
      const x = redKing.x;
      const lo = Math.min(redKing.y, blackKing.y) + 1;
      const hi = Math.max(redKing.y, blackKing.y);
      let blocked = false;
      for (let y = lo; y < hi; y += 1) {
        if (board[y][x]) { blocked = true; break; }
      }
      if (!blocked) return true;
    }

    return false;
  }

  function applyMoveRaw(board, move) {
    const fromX = move.from.x;
    const fromY = move.from.y;
    const toX = move.to.x;
    const toY = move.to.y;
    const captured = board[toY][toX];
    board[toY][toX] = board[fromY][fromX];
    board[fromY][fromX] = null;
    return captured;
  }

  function undoMoveRaw(board, move, captured) {
    board[move.from.y][move.from.x] = board[move.to.y][move.to.x];
    board[move.to.y][move.to.x] = captured || null;
  }

  function legalMovesFrom(board, x, y) {
    const piece = board[y][x];
    if (!piece) return [];
    const side = sideOf(piece);
    const legal = [];
    for (const target of pseudoMovesFrom(board, x, y)) {
      const move = { from: { x, y }, to: { x: target.x, y: target.y } };
      const captured = applyMoveRaw(board, move);
      const safe = !isInCheck(board, side);
      undoMoveRaw(board, move, captured);
      if (safe) legal.push(target);
    }
    return legal;
  }

  function allLegalMoves(board, side) {
    const moves = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = board[y][x];
        if (!piece || sideOf(piece) !== side) continue;
        for (const target of legalMovesFrom(board, x, y)) {
          moves.push({
            from: { x, y },
            to: { x: target.x, y: target.y },
            piece,
            captured: board[target.y][target.x] || null,
          });
        }
      }
    }
    return moves;
  }

  function hasAnyLegalMove(board, side) {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = board[y][x];
        if (!piece || sideOf(piece) !== side) continue;
        const moves = pseudoMovesFrom(board, x, y);
        for (const target of moves) {
          const move = { from: { x, y }, to: { x: target.x, y: target.y } };
          const captured = applyMoveRaw(board, move);
          const safe = !isInCheck(board, side);
          undoMoveRaw(board, move, captured);
          if (safe) return true;
        }
      }
    }
    return false;
  }

  function isLegalTarget(board, from, to) {
    if (!inside(from.x, from.y) || !inside(to.x, to.y)) return false;
    const piece = board[from.y][from.x];
    if (!piece) return false;
    return legalMovesFrom(board, from.x, from.y).some((m) => m.x === to.x && m.y === to.y);
  }

  function fileNumber(x, side) {
    return side === 'r' ? 9 - x : x + 1;
  }

  function moveToChinese(move, boardBefore, side) {
    const piece = boardBefore[move.from.y][move.from.x];
    if (!piece) return '';
    const type = typeOf(piece);
    const name = PIECE_NAMES[piece];
    const fromFile = fileNumber(move.from.x, side);
    const toFile = fileNumber(move.to.x, side);
    const action = move.to.y === move.from.y
      ? '平'
      : ((side === 'r' ? move.to.y < move.from.y : move.to.y > move.from.y) ? '进' : '退');
    const diagonal = type === 'h' || type === 'e' || type === 'a';
    const amount = diagonal || action === '平'
      ? toFile
      : Math.abs(move.to.y - move.from.y);

    const sameFile = [];
    for (let y = 0; y < ROWS; y += 1) {
      const p = boardBefore[y][move.from.x];
      if (p && typeOf(p) === type && sideOf(p) === side) sameFile.push(y);
    }

    let prefix = '';
    if (sameFile.length > 1) {
      const ordered = side === 'r' ? sameFile.slice().sort((a, b) => a - b) : sameFile.slice().sort((a, b) => b - a);
      const index = ordered.indexOf(move.from.y);
      if (index === 0) prefix = '前';
      else if (index === ordered.length - 1) prefix = '后';
      else prefix = '中';
    }

    const head = prefix ? `${prefix}${name}` : `${name}${chineseNum(fromFile)}`;
    return `${head}${action}${chineseNum(amount)}`;
  }

  function resultText(result) {
    if (!result) return '';
    if (result.reason === '认输') return `${result.winner === 'r' ? '红方' : '黑方'}胜 · 对方认输`;
    if (result.reason === '对手离开') return `${result.winner === 'r' ? '红方' : '黑方'}胜 · 对手离开`;
    return `${result.winner === 'r' ? '红方' : '黑方'}胜 · ${result.reason}`;
  }

  /* ---------------- AI ---------------- */

  const SEARCH_TIMEOUT = { timeout: true };
  let searchDeadline = 0;
  let searchNodes = 0;

  function evaluate(board, side) {
    let score = 0;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = board[y][x];
        if (!piece) continue;
        const s = sideOf(piece);
        const t = typeOf(piece);
        let value = PIECE_VALUES[t] || 0;
        if (t === 'p') {
          value += s === 'r' ? Math.max(0, 6 - y) * 14 : Math.max(0, y - 3) * 14;
          if ((s === 'r' && y <= 4) || (s === 'b' && y >= 5)) value += 22;
        } else if (t === 'h' || t === 'c') {
          value += (4 - Math.abs(x - 4)) * 3;
        } else if (t === 'r') {
          value += (4 - Math.abs(x - 4)) * 2;
        } else if (t === 'a' || t === 'e') {
          value += 8;
        }
        score += s === 'r' ? value : -value;
      }
    }
    score += side === 'r' ? 6 : -6;
    return side === 'r' ? score : -score;
  }

  function moveOrderScore(move) {
    let score = 0;
    if (move.captured) {
      score += 100000 + (PIECE_VALUES[typeOf(move.captured)] || 0) * 8 - (PIECE_VALUES[typeOf(move.piece)] || 0);
    }
    const center = 4 - Math.abs(move.to.x - 4);
    score += center;
    return score;
  }

  function orderMoves(moves, preferred = null) {
    return moves.slice().sort((a, b) => {
      if (preferred) {
        if (a.from.x === preferred.from.x && a.from.y === preferred.from.y && a.to.x === preferred.to.x && a.to.y === preferred.to.y) return -1;
        if (b.from.x === preferred.from.x && b.from.y === preferred.from.y && b.to.x === preferred.to.x && b.to.y === preferred.to.y) return 1;
      }
      return moveOrderScore(b) - moveOrderScore(a);
    });
  }

  function negamax(board, side, depth, alpha, beta, ply) {
    searchNodes += 1;
    if ((searchNodes & 511) === 0 && now() > searchDeadline) throw SEARCH_TIMEOUT;

    if (depth <= 0) {
      if (!hasAnyLegalMove(board, side)) return -MATE + ply;
      return evaluate(board, side);
    }

    const moves = allLegalMoves(board, side);
    if (!moves.length) return -MATE + ply;
    orderMoves(moves);

    let best = -Infinity;
    for (const move of moves) {
      const captured = applyMoveRaw(board, move);
      let score;
      try {
        score = -negamax(board, other(side), depth - 1, -beta, -alpha, ply + 1);
      } finally {
        undoMoveRaw(board, move, captured);
      }
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseAIMove(board, side, levelName = 'normal') {
    const level = LEVELS[levelName] || LEVELS.normal;
    const legal = allLegalMoves(board, side);
    if (!legal.length) return null;

    if (levelName === 'easy') {
      if (Math.random() < level.random) return legal[Math.floor(Math.random() * legal.length)];
      let best = legal[0];
      let bestScore = -Infinity;
      for (const move of legal) {
        const captured = applyMoveRaw(board, move);
        const score = evaluate(board, side) + Math.random() * 45 + (captured ? 80 : 0);
        undoMoveRaw(board, move, captured);
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    }

    searchDeadline = now() + level.time;
    searchNodes = 0;
    let best = legal[0];

    for (let depth = 1; depth <= level.depth; depth += 1) {
      let alpha = -MATE;
      let localBest = null;
      let localScore = -Infinity;
      const ordered = orderMoves(legal, best);
      try {
        for (const move of ordered) {
          const captured = applyMoveRaw(board, move);
          let score;
          try {
            score = -negamax(board, other(side), depth - 1, -MATE, -alpha, 1);
          } finally {
            undoMoveRaw(board, move, captured);
          }
          if (score > localScore) {
            localScore = score;
            localBest = move;
          }
          if (score > alpha) alpha = score;
        }
      } catch (error) {
        if (error !== SEARCH_TIMEOUT) throw error;
        break;
      }

      if (localBest) {
        best = localBest;
        if (localScore >= MATE - 1000) break;
      }
      if (now() > searchDeadline) break;
    }

    return best;
  }

  /* ---------------- 音效 ---------------- */

  const audio = {
    ctx: null,
    muted: safeGet(STORE.muted, false) === true,
    ensure() {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, duration = 0.08, type = 'sine', volume = 0.05, delay = 0) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    },
    move() { this.tone(520, 0.06, 'sine', 0.045); this.tone(740, 0.05, 'sine', 0.025, 0.03); },
    capture() { this.tone(220, 0.09, 'triangle', 0.06); this.tone(140, 0.12, 'sine', 0.04, 0.03); },
    check() { this.tone(880, 0.09, 'square', 0.035); this.tone(1180, 0.12, 'square', 0.03, 0.08); },
    win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.045, i * 0.09)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.045, i * 0.1)); },
    notify() { this.tone(660, 0.07, 'sine', 0.035); },
  };

  function updateSoundUI() {
    if (!dom.soundBtn) return;
    dom.soundBtn.classList.toggle('is-muted', audio.muted);
    dom.soundBtn.setAttribute('aria-pressed', String(!audio.muted));
    dom.soundBtn.title = audio.muted ? '开启音效' : '关闭音效';
    if (dom.soundWave) dom.soundWave.style.opacity = audio.muted ? '0.2' : '1';
  }

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove('is-visible'), 2200);
  }

  /* ---------------- 棋盘绘制 ---------------- */

  function buildWood() {
    const width = 1024;
    const height = Math.round((width * BOARD_H) / BOARD_W);
    woodCanvas = document.createElement('canvas');
    woodCanvas.width = width;
    woodCanvas.height = height;
    const c = woodCanvas.getContext('2d');

    const base = c.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, '#d8b27c');
    base.addColorStop(0.35, '#cda467');
    base.addColorStop(0.62, '#d8b27a');
    base.addColorStop(1, '#bd8f56');
    c.fillStyle = base;
    c.fillRect(0, 0, width, height);

    for (let i = 0; i < 85; i += 1) {
      c.strokeStyle = `rgba(${90 + Math.random() * 40},${58 + Math.random() * 24},${26 + Math.random() * 16},${0.035 + Math.random() * 0.06})`;
      c.lineWidth = 0.5 + Math.random() * 2.2;
      c.beginPath();
      let x = -20;
      let y = Math.random() * height;
      c.moveTo(x, y);
      while (x < width + 20) {
        x += 60 + Math.random() * 90;
        y += Math.sin(x * 0.009 + i) * 8 + (Math.random() - 0.5) * 6;
        c.lineTo(x, y);
      }
      c.stroke();
    }

    for (let i = 0; i < 8; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 18 + Math.random() * 48;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(92,55,24,0.09)');
      g.addColorStop(0.55, 'rgba(92,55,24,0.035)');
      g.addColorStop(1, 'rgba(92,55,24,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const vignette = c.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.72);
    vignette.addColorStop(0, 'rgba(255,245,220,0.03)');
    vignette.addColorStop(0.75, 'rgba(65,36,14,0.04)');
    vignette.addColorStop(1, 'rgba(45,24,10,0.2)');
    c.fillStyle = vignette;
    c.fillRect(0, 0, width, height);
  }

  function resizeCanvas() {
    if (!dom.canvas || !dom.boardFrame) return;
    const cssWidth = dom.canvas.getBoundingClientRect().width;
    if (!cssWidth) return;
    const cssHeight = cssWidth * (BOARD_H / BOARD_W);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dom.canvas.style.height = `${cssHeight}px`;
    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    boardScale = dom.canvas.width / BOARD_W;
    queueRender();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      drawBoard();
    });
  }

  function displayPos(x, y) {
    return game.flipped ? { x: COLS - 1 - x, y: ROWS - 1 - y } : { x, y };
  }

  function boardPoint(dx, dy) {
    return {
      x: MARGIN + dx * STEP,
      y: MARGIN + dy * STEP,
    };
  }

  function drawBoard() {
    if (!ctx || !dom.canvas.width) return;
    const scale = boardScale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    if (woodCanvas) {
      ctx.drawImage(woodCanvas, 0, 0, BOARD_W, BOARD_H);
    } else {
      ctx.fillStyle = '#cda76c';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    }

    // 外框
    ctx.strokeStyle = 'rgba(72,43,22,0.88)';
    ctx.lineWidth = 0.045;
    ctx.strokeRect(MARGIN - 0.16, MARGIN - 0.16, (COLS - 1) + 0.32, (ROWS - 1) + 0.32);
    ctx.strokeStyle = 'rgba(78,48,25,0.42)';
    ctx.lineWidth = 0.018;
    ctx.strokeRect(MARGIN - 0.27, MARGIN - 0.27, (COLS - 1) + 0.54, (ROWS - 1) + 0.54);

    // 横线
    ctx.strokeStyle = 'rgba(73,45,24,0.76)';
    ctx.lineWidth = 0.019;
    for (let y = 0; y < ROWS; y += 1) {
      const p = boardPoint(0, y);
      ctx.beginPath();
      ctx.moveTo(MARGIN, p.y);
      ctx.lineTo(MARGIN + (COLS - 1), p.y);
      ctx.stroke();
    }

    // 竖线：中间让出楚河汉界
    for (let x = 0; x < COLS; x += 1) {
      const p = boardPoint(x, 0);
      if (x === 0 || x === COLS - 1) {
        ctx.beginPath();
        ctx.moveTo(p.x, MARGIN);
        ctx.lineTo(p.x, MARGIN + (ROWS - 1));
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x, MARGIN);
        ctx.lineTo(p.x, MARGIN + 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, MARGIN + 5);
        ctx.lineTo(p.x, MARGIN + (ROWS - 1));
        ctx.stroke();
      }
    }

    // 九宫斜线
    ctx.lineWidth = 0.017;
    const palaces = [
      [[3, 0], [5, 2]], [[5, 0], [3, 2]],
      [[3, 7], [5, 9]], [[5, 7], [3, 9]],
    ];
    for (const [a, b] of palaces) {
      const p1 = boardPoint(a[0], a[1]);
      const p2 = boardPoint(b[0], b[1]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // 楚河汉界
    ctx.save();
    ctx.fillStyle = 'rgba(80,49,26,0.62)';
    ctx.font = '600 0.38px "STKaiti","KaiTi","Kaiti SC","Songti SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚  河', MARGIN + 1.9, MARGIN + 4.5);
    ctx.fillText('漢  界', MARGIN + 5.9, MARGIN + 4.5);
    ctx.restore();

    // 兵炮位标记
    drawPositionMarks();

    // 上手标记
    if (game.lastMove) {
      drawStationMark(game.lastMove.from, 'rgba(185,65,50,0.2)');
      drawStationMark(game.lastMove.to, 'rgba(199,161,90,0.3)');
    }

    // 提示走法
    if (game.hintMove) {
      drawTargetRing(game.hintMove.to, 'rgba(99,165,143,0.85)', 0.45);
    }

    // 棋子
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = game.board[y][x];
        if (!piece) continue;
        const pos = displayPos(x, y);
        const selected = game.selected && game.selected.x === x && game.selected.y === y;
        drawPiece(pos.x, pos.y, piece, selected);
      }
    }

    // 合法落点
    if (game.selected) {
      for (const move of game.legal) {
        const pos = displayPos(move.x, move.y);
        const target = game.board[move.y][move.x];
        if (target) {
          drawTargetRing(pos, 'rgba(185,65,50,0.85)', 0.43);
        } else {
          const p = boardPoint(pos.x, pos.y);
          ctx.beginPath();
          ctx.fillStyle = 'rgba(55,92,73,0.58)';
          ctx.arc(p.x, p.y, 0.085, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(236,222,190,0.45)';
          ctx.lineWidth = 0.012;
          ctx.stroke();
        }
      }
    }

    // 被将军的将/帅
    if (game.check && game.phase !== 'over') {
      const king = findKing(game.board, game.turn);
      if (king) {
        const pos = displayPos(king.x, king.y);
        drawTargetRing(pos, 'rgba(185,65,50,0.95)', 0.48);
      }
    }

    // 角落印章
    ctx.save();
    ctx.translate(BOARD_W - 0.43, BOARD_H - 0.43);
    ctx.rotate(-0.08);
    ctx.strokeStyle = 'rgba(158,43,35,0.36)';
    ctx.lineWidth = 0.022;
    ctx.strokeRect(-0.18, -0.18, 0.36, 0.36);
    ctx.fillStyle = 'rgba(158,43,35,0.38)';
    ctx.font = '600 0.25px "STKaiti","KaiTi",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('棋', 0, 0.015);
    ctx.restore();
  }

  function drawPositionMarks() {
    const marks = [
      [1, 2], [7, 2], [1, 7], [7, 7],
      [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
      [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
    ];
    ctx.strokeStyle = 'rgba(85,52,28,0.34)';
    ctx.lineWidth = 0.014;
    for (const [x, y] of marks) {
      const p = boardPoint(x, y);
      const sign = x === 0 ? 1 : x === COLS - 1 ? -1 : 0;
      const length = 0.12;
      const gap = 0.1;
      const corners = sign ? [[sign, -1], [sign, 1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(p.x + sx * gap, p.y + sy * gap + sy * length);
        ctx.lineTo(p.x + sx * gap, p.y + sy * gap);
        ctx.lineTo(p.x + sx * gap + sx * length, p.y + sy * gap);
        ctx.stroke();
      }
    }
  }

  function drawStationMark(cell, color) {
    const pos = displayPos(cell.x, cell.y);
    const p = boardPoint(pos.x, pos.y);
    ctx.fillStyle = color;
    ctx.fillRect(p.x - 0.43, p.y - 0.43, 0.86, 0.86);
    ctx.strokeStyle = 'rgba(199,161,90,0.35)';
    ctx.lineWidth = 0.014;
    ctx.strokeRect(p.x - 0.43, p.y - 0.43, 0.86, 0.86);
  }

  function drawTargetRing(pos, color, radius) {
    const p = boardPoint(pos.x, pos.y);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.036;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPiece(dx, dy, piece, selected) {
    const p = boardPoint(dx, dy);
    const red = isRed(piece);
    const radius = 0.415;
    const color = red ? '#a52b23' : '#20272a';
    const border = red ? '#9e2b25' : '#283033';

    ctx.save();
    if (selected) {
      ctx.shadowColor = 'rgba(199,161,90,0.8)';
      ctx.shadowBlur = 0.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.49, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(226,197,128,0.95)';
      ctx.lineWidth = 0.045;
      ctx.stroke();
    }

    ctx.shadowColor = 'rgba(50,28,10,0.42)';
    ctx.shadowBlur = 0.14;
    ctx.shadowOffsetY = 0.06;
    const fill = ctx.createRadialGradient(p.x - 0.13, p.y - 0.15, 0.04, p.x, p.y, radius);
    fill.addColorStop(0, '#faf1dd');
    fill.addColorStop(0.55, '#ecdcba');
    fill.addColorStop(1, '#ceb183');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = border;
    ctx.lineWidth = 0.028;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius - 0.075, 0, Math.PI * 2);
    ctx.strokeStyle = red ? 'rgba(158,43,35,0.42)' : 'rgba(39,48,51,0.48)';
    ctx.lineWidth = 0.012;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '700 0.54px "STKaiti","KaiTi","Kaiti SC","Songti SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_NAMES[piece], p.x, p.y + 0.015);
    ctx.restore();
  }

  function eventToCell(event) {
    const rect = dom.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) / rect.width) * BOARD_W;
    const y = ((event.clientY - rect.top) / rect.height) * BOARD_H;
    let dx = Math.round((x - MARGIN) / STEP);
    let dy = Math.round((y - MARGIN) / STEP);
    if (dx < 0 || dx >= COLS || dy < 0 || dy >= ROWS) return null;
    const px = MARGIN + dx * STEP;
    const py = MARGIN + dy * STEP;
    if (Math.abs(x - px) > 0.43 || Math.abs(y - py) > 0.43) return null;
    if (game.flipped) {
      dx = COLS - 1 - dx;
      dy = ROWS - 1 - dy;
    }
    return { x: dx, y: dy };
  }

  /* ---------------- 面板 / 通用 UI ---------------- */

  function setStatusPill(text, cls = '') {
    dom.statusPillText.textContent = text;
    dom.statusPill.className = `status-pill${cls ? ` ${cls}` : ''}`;
  }

  function setConnection(text, kind = 'local') {
    dom.connectionText.textContent = text;
    dom.connectionPill.className = 'connection-pill';
    if (kind === 'online') dom.connectionPill.classList.add('is-online');
    if (kind === 'offline') dom.connectionPill.classList.add('is-offline');
  }

  function showPanel(name) {
    const panels = {
      menu: dom.menuPanel,
      ai: dom.aiPanel,
      online: dom.onlinePanel,
      puzzle: dom.puzzlePanel,
      game: dom.gamePanel,
    };
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = key !== name;
    });

    if (name === 'menu') {
      dom.panelKicker.textContent = 'WELCOME';
      dom.panelTitle.textContent = '选择对局模式';
      dom.footMode.textContent = 'LOCAL · 规则引擎';
      setStatusPill('待机');
    } else if (name === 'ai') {
      dom.panelKicker.textContent = 'AI MATCH';
      dom.panelTitle.textContent = '人机对战';
      dom.footMode.textContent = 'SOLO · 四档 AI';
      setStatusPill('配置中', 'is-wait');
    } else if (name === 'online') {
      dom.panelKicker.textContent = 'ONLINE MATCH';
      dom.panelTitle.textContent = '联机对战';
      dom.footMode.textContent = 'ONLINE · 公共中继';
      if (online.active) setStatusPill(online.status === 'playing' ? '对局中' : '等待中', 'is-wait');
      else setStatusPill('配置中', 'is-wait');
    } else if (name === 'puzzle') {
      dom.panelKicker.textContent = 'ENDGAME';
      dom.panelTitle.textContent = '残局挑战';
      dom.footMode.textContent = 'PUZZLE · 五道残局';
      setStatusPill('选择关卡', 'is-wait');
    } else if (name === 'game') {
      dom.footMode.textContent = game.mode === 'online'
        ? 'ONLINE · 房主维护棋局'
        : game.mode === 'puzzle' ? 'PUZZLE · 红方先行' : 'SOLO · 红方先行';
    }
  }

  function hideResult() {
    dom.boardOverlay.hidden = true;
    dom.resultActions.replaceChildren();
  }

  function showThinking(text = 'AI 思考中') {
    if (!dom.thinking) return;
    dom.thinkingText.textContent = text;
    dom.thinking.hidden = false;
  }

  function hideThinking() {
    if (dom.thinking) dom.thinking.hidden = true;
  }

  /* ---------------- 残局列表 ---------------- */

  function clearedPuzzles() {
    const value = safeGet(STORE.puzzles, []);
    return Array.isArray(value) ? value : [];
  }

  function markPuzzleCleared(id) {
    const list = clearedPuzzles();
    if (!list.includes(id)) {
      list.push(id);
      safeSet(STORE.puzzles, list);
    }
    renderPuzzleList();
  }

  function renderPuzzleList() {
    const cleared = clearedPuzzles();
    dom.puzzleList.replaceChildren();
    PUZZLES.forEach((puzzle, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `puzzle-card${cleared.includes(puzzle.id) ? ' is-cleared' : ''}`;
      const no = document.createElement('span');
      no.className = 'puzzle-no';
      no.textContent = pad(index + 1);
      const info = document.createElement('span');
      info.className = 'puzzle-info';
      const name = document.createElement('strong');
      name.textContent = puzzle.name;
      const sub = document.createElement('span');
      sub.textContent = puzzle.subtitle;
      info.append(name, sub);
      const diff = document.createElement('span');
      diff.className = 'puzzle-diff';
      diff.textContent = cleared.includes(puzzle.id) ? '已破' : puzzle.diff;
      button.append(no, info, diff);
      button.addEventListener('click', () => startPuzzle(index));
      dom.puzzleList.append(button);
    });
  }

  /* ---------------- 对局开始 / 重置 ---------------- */

  function resetPosition(fen = START_FEN) {
    const parsed = parseFen(fen);
    game.board = parsed.board;
    game.turn = parsed.turn;
    game.selected = null;
    game.legal = [];
    game.lastMove = null;
    game.history = [];
    game.log = [];
    game.captured = { r: [], b: [] };
    game.result = null;
    game.check = isInCheck(game.board, game.turn);
    game.phase = 'idle';
    game.hintMove = null;
    game.hintText = '';
    game.aiToken += 1;
    hideResult();
    hideThinking();
    queueRender();
  }

  function startAIGame(level = game.aiLevel) {
    cancelAI();
    if (online.active) stopOnline();
    game.aiLevel = LEVELS[level] ? level : 'normal';
    game.mode = 'ai';
    game.playerSide = 'r';
    game.flipped = false;
    resetPosition(START_FEN);
    game.phase = 'playing';
    showPanel('game');
    setConnection('本地对局', 'local');
    updateAll();
  }

  function startPuzzle(index) {
    const puzzle = PUZZLES[index];
    if (!puzzle) return;
    cancelAI();
    if (online.active) stopOnline();
    try {
      const parsed = parseFen(puzzle.fen);
      resetPosition(puzzle.fen);
      game.board = parsed.board;
      game.turn = parsed.turn;
      game.check = isInCheck(game.board, game.turn);
    } catch (error) {
      toast('残局数据无效');
      return;
    }
    game.mode = 'puzzle';
    game.playerSide = 'r';
    game.flipped = false;
    game.puzzleIndex = index;
    game.puzzleFen = puzzle.fen;
    game.aiLevel = puzzle.ai;
    game.phase = 'playing';
    showPanel('game');
    setConnection('残局挑战', 'local');
    updateAll();
    toast(`残局 ${index + 1} · ${puzzle.name}`);
  }

  /* ---------------- 对局状态更新 ---------------- */

  function sideName(side) {
    return side === 'r' ? '红方' : '黑方';
  }

  function updateSideTags() {
    const topSide = game.flipped ? 'r' : 'b';
    const bottomSide = game.flipped ? 'b' : 'r';
    updateSideTag(dom.topSideTag, dom.topSideState, topSide);
    updateSideTag(dom.bottomSideTag, dom.bottomSideState, bottomSide);
  }

  function updateSideTag(tag, stateEl, side) {
    const dot = tag.querySelector('.side-dot');
    const name = tag.querySelector('b');
    const en = tag.querySelector('em');
    dot.className = `side-dot ${side === 'r' ? 'red' : 'black'}`;
    name.textContent = sideName(side);
    en.textContent = side === 'r' ? 'RED' : 'BLACK';

    if (!game.mode || game.mode === 'menu') {
      stateEl.textContent = '';
      return;
    }

    const isPlayer = side === game.playerSide;
    const turn = game.turn === side;
    const active = game.phase === 'playing' || game.phase === 'thinking';
    if (!active) {
      stateEl.textContent = '';
      return;
    }
    if (game.mode === 'online') {
      stateEl.textContent = isPlayer
        ? (turn ? '你的回合' : '你 · 等待')
        : (turn ? '对手行棋' : '对手 · 等待');
    } else if (game.mode === 'ai' || game.mode === 'puzzle') {
      stateEl.textContent = isPlayer
        ? (turn ? '你的回合' : '你 · 等待')
        : (turn ? (game.phase === 'thinking' ? 'AI 思考中' : 'AI 行棋') : 'AI · 等待');
    }
  }

  function updateAll() {
    updateGamePanel();
    updateSideTags();
    updateConnectionUI();
    updateOnlineRoom();
    queueRender();
  }

  function updateGamePanel() {
    if (!dom.gamePanel) return;
    if (!['ai', 'puzzle', 'online'].includes(game.mode)) return;

    const isOnline = game.mode === 'online';
    const level = LEVELS[game.aiLevel] || LEVELS.normal;
    const puzzle = PUZZLES[game.puzzleIndex];

    if (game.mode === 'ai') {
      dom.panelKicker.textContent = 'AI MATCH';
      dom.panelTitle.textContent = '人机对战';
    } else if (game.mode === 'puzzle') {
      dom.panelKicker.textContent = 'ENDGAME';
      dom.panelTitle.textContent = puzzle ? `残局 · ${puzzle.name}` : '残局挑战';
    } else {
      dom.panelKicker.textContent = 'ONLINE MATCH';
      dom.panelTitle.textContent = '联机对战';
    }

    dom.gameRoomBar.hidden = !isOnline;
    dom.gameRoomCode.textContent = isOnline ? online.code : '------';
    dom.gameOpponent.textContent = isOnline
      ? (online.role === 'host'
        ? (online.guestName ? `对手 ${online.guestName}` : '等待对手')
        : (online.hostName ? `对手 ${online.hostName}` : '连接中'))
      : '';
    dom.gameActions.hidden = isOnline;
    dom.onlineGameActions.hidden = !isOnline;

    const turnSide = game.turn;
    const red = turnSide === 'r';
    const discRed = game.phase === 'over' && game.result ? game.result.winner === 'r' : red;
    dom.turnDisc.textContent = game.phase === 'over' && game.result
      ? (game.result.winner === 'r' ? '红' : '黑')
      : (red ? '红' : '黑');
    dom.turnDisc.classList.toggle('is-black', !discRed);
    dom.turnLabel.textContent = game.phase === 'over' ? '对局结束' : `${sideName(turnSide)}行棋`;
    dom.turnSide.textContent = game.phase === 'over' ? 'FINISHED' : (red ? 'RED' : 'BLACK');

    let strong = '准备开始';
    if (game.phase === 'over') strong = '对局结束';
    else if (game.phase === 'thinking') strong = 'AI 思考中';
    else if (isOnline) {
      if (!online.joined || online.status === 'waiting') strong = '等待对手';
      else if (online.movePending) strong = '等待同步';
      else strong = turnSide === game.playerSide ? '轮到你' : '等待对方';
    } else {
      strong = turnSide === game.playerSide ? '轮到你' : 'AI 行棋';
    }
    if (game.phase === 'over' && game.result) strong = `${sideName(game.result.winner)}胜`;
    dom.turnStrong.textContent = strong;

    let status = '点击棋子选择走法。';
    if (game.phase === 'over' && game.result) {
      status = resultText(game.result);
    } else if (isOnline && (!online.joined || online.status === 'waiting')) {
      status = '等待好友加入房间…把房间号发给对方。';
    } else if (isOnline && online.status === 'connecting') {
      status = '正在连接房间…';
    } else if (game.phase === 'thinking') {
      status = 'AI 正在计算下一步…';
    } else if (isOnline && turnSide !== game.playerSide) {
      status = '对方正在思考，等待同步…';
    } else if (game.check) {
      status = '将军！请应将。';
    } else if (game.selected) {
      const piece = game.board[game.selected.y][game.selected.x];
      status = `已选中「${PIECE_NAMES[piece]}」，点击高亮位置落子。`;
    } else if (isOnline && online.movePending) {
      status = '走法已发送，等待房主同步…';
    }
    dom.gameStatusText.textContent = status;

    dom.checkFlag.hidden = !(game.check && game.phase !== 'over');
    dom.thinking.hidden = game.phase !== 'thinking';
    if (game.phase === 'thinking') dom.thinkingText.textContent = 'AI 思考中';

    if (game.result) {
      dom.lastMoveText.textContent = resultText(game.result);
    } else if (game.lastMove) {
      const lastLog = game.log[game.log.length - 1];
      dom.lastMoveText.textContent = lastLog
        ? `上一手：${lastLog.side === 'r' ? '红' : '黑'} ${lastLog.notation}${lastLog.mark || ''}`
        : '行棋中';
    } else {
      dom.lastMoveText.textContent = game.mode === 'puzzle'
        ? '红方先行 · 目标：将死黑方'
        : '红方先行 · 点击棋子开始';
    }

    let pillText = '行棋中';
    let pillClass = 'is-live';
    if (game.phase === 'over') {
      pillText = '已结束';
      pillClass = 'is-over';
    } else if (game.phase === 'thinking') {
      pillText = '思考中';
      pillClass = 'is-wait';
    } else if (isOnline) {
      if (!online.wsReady) {
        pillText = '连接中';
        pillClass = 'is-over';
      } else if (!online.joined || online.status === 'waiting') {
        pillText = '等待中';
        pillClass = 'is-wait';
      } else if (online.status === 'offline') {
        pillText = '连接不稳';
        pillClass = 'is-over';
      }
    } else if (game.mode === 'puzzle') {
      pillText = `残局 ${pad(game.puzzleIndex + 1)}`;
      pillClass = 'is-wait';
    } else {
      pillText = level.name;
      pillClass = 'is-live';
    }
    setStatusPill(pillText, pillClass);

    dom.undoBtn.disabled = isOnline || game.history.length === 0;
    dom.hintBtn.hidden = game.mode !== 'puzzle';
    dom.hintBtn.disabled = game.phase !== 'playing' || game.turn !== 'r';
    dom.resignBtn.disabled = game.phase === 'over' || (isOnline && !online.joined);
    dom.onlineResignBtn.disabled = game.phase === 'over' || !online.joined;
    dom.onlineLeaveBtn.disabled = false;

    updateCaptured();
    updateMoveList();
  }

  function updateCaptured() {
    renderCaptured(dom.capturedByRed, game.captured.r, true);
    renderCaptured(dom.capturedByBlack, game.captured.b, false);
  }

  function renderCaptured(container, pieces, capturedBlack) {
    container.replaceChildren();
    if (!pieces.length) {
      const empty = document.createElement('span');
      empty.className = 'cap-empty';
      empty.textContent = '—';
      empty.style.color = 'var(--muted-2)';
      empty.style.fontSize = '9px';
      container.append(empty);
      return;
    }
    for (const piece of pieces) {
      const span = document.createElement('span');
      span.className = `cap-piece${capturedBlack ? ' black' : ''}`;
      span.textContent = PIECE_NAMES[piece] || '?';
      container.append(span);
    }
  }

  function updateMoveList() {
    dom.moveList.replaceChildren();
    dom.moveCount.textContent = `${game.log.length} 手`;
    if (!game.log.length) {
      const empty = document.createElement('div');
      empty.className = 'move-empty';
      empty.textContent = '尚未落子';
      dom.moveList.append(empty);
      return;
    }
    game.log.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'move-row';
      const no = document.createElement('span');
      no.className = 'move-no';
      no.textContent = pad(Math.floor(index / 2) + 1);
      const dot = document.createElement('span');
      dot.className = `move-dot${entry.side === 'b' ? ' black' : ''}`;
      const text = document.createElement('span');
      text.className = 'move-text';
      text.textContent = entry.notation;
      row.append(no, dot, text);
      if (entry.mark) {
        const mark = document.createElement('span');
        mark.className = 'move-mark';
        mark.textContent = entry.mark;
        row.append(mark);
      }
      dom.moveList.append(row);
    });
    dom.moveList.scrollTop = dom.moveList.scrollHeight;
  }

  function updateConnectionUI() {
    if (online.active && online.code) {
      if (!online.wsReady) {
        setConnection(`房间 ${online.code} · 连接中`, 'offline');
      } else if (online.status === 'offline') {
        setConnection(`房间 ${online.code} · 重连中`, 'offline');
      } else if (online.joined || online.status === 'playing' || online.status === 'finished') {
        setConnection(`房间 ${online.code} · 联机中`, 'online');
      } else {
        setConnection(`房间 ${online.code} · 等待`, 'online');
      }
    } else if (game.mode === 'menu') {
      setConnection('本地对局', 'local');
    } else if (game.mode === 'puzzle') {
      setConnection('残局挑战', 'local');
    } else {
      setConnection('本地对局', 'local');
    }
  }

  /* ---------------- 走子 ---------------- */

  function selectCell(cell) {
    const piece = game.board[cell.y][cell.x];
    if (!piece || sideOf(piece) !== game.turn) {
      game.selected = null;
      game.legal = [];
      queueRender();
      updateGamePanel();
      return;
    }
    game.selected = { x: cell.x, y: cell.y };
    game.legal = legalMovesFrom(game.board, cell.x, cell.y);
    queueRender();
    updateGamePanel();
  }

  function handleBoardClick(event) {
    if (!game.mode || game.mode === 'menu' || game.phase === 'over') return;
    if (game.phase === 'thinking') return;
    const cell = eventToCell(event);
    if (!cell) return;

    if (game.mode === 'online') {
      if (!online.joined || online.status === 'waiting') {
        toast('等待好友加入房间');
        return;
      }
      if (game.turn !== game.playerSide) {
        toast('还没轮到你走棋');
        return;
      }
      if (online.role === 'guest' && online.movePending) {
        toast('上一手正在同步，请稍候');
        return;
      }
    } else if (game.turn !== 'r') {
      return;
    }

    if (game.selected) {
      if (game.legal.some((m) => m.x === cell.x && m.y === cell.y)) {
        if (game.mode === 'online' && online.role === 'guest') {
          sendGuestMove(game.selected, cell);
          game.selected = null;
          game.legal = [];
          queueRender();
          updateGamePanel();
        } else {
          performMove(game.selected, cell);
        }
        return;
      }
    }

    selectCell(cell);
  }

  function performMove(from, to, options = {}) {
    if (game.phase !== 'playing') return false;
    if (!inside(from.x, from.y) || !inside(to.x, to.y)) return false;
    const piece = game.board[from.y][from.x];
    if (!piece || sideOf(piece) !== game.turn) return false;
    const legal = legalMovesFrom(game.board, from.x, from.y);
    if (!legal.some((m) => m.x === to.x && m.y === to.y)) return false;

    const side = game.turn;
    const notation = moveToChinese({ from, to }, game.board, side);
    const captured = game.board[to.y][to.x] || null;
    applyMoveRaw(game.board, { from, to });
    game.selected = null;
    game.legal = [];
    game.hintMove = null;
    game.hintText = '';
    game.lastMove = {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      piece,
      captured,
    };
    if (captured) game.captured[side].push(captured);

    game.turn = other(side);
    game.check = isInCheck(game.board, game.turn);
    const replies = allLegalMoves(game.board, game.turn);
    let result = null;
    if (!replies.length) {
      result = { winner: side, reason: game.check ? '将死' : '困毙' };
      game.result = result;
      game.phase = 'over';
    }

    const mark = result ? '#' : (game.check ? '+' : '');
    game.log.push({ side, notation, mark });
    game.history.push({
      move: { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } },
      captured,
      side,
      notation,
      mark,
    });

    if (captured) audio.capture();
    else audio.move();
    if (game.check) audio.check();

    updateAll();

    if (result) {
      handleGameOver();
      if (game.mode === 'online' && online.role === 'host') {
        publishState('finished', true);
      }
    } else {
      if (game.mode === 'online' && online.role === 'host') {
        publishState(game.phase, true);
      }
      if ((game.mode === 'ai' || game.mode === 'puzzle') && game.turn === 'b') {
        scheduleAI();
      }
    }

    return true;
  }

  function finishGame(winner, reason) {
    if (game.phase === 'over') return;
    game.phase = 'over';
    game.result = { winner, reason };
    game.selected = null;
    game.legal = [];
    updateAll();
    handleGameOver();
    if (game.mode === 'online' && online.role === 'host') {
      publishState('finished', true);
    }
  }

  function handleGameOver() {
    if (!game.result) return;
    const playerWon = game.result.winner === game.playerSide;
    if (game.mode === 'puzzle' && playerWon) {
      markPuzzleCleared(PUZZLES[game.puzzleIndex].id);
    }
    if (playerWon) audio.win();
    else audio.lose();
    showResultOverlay(game.result);
  }

  function showResultOverlay(result) {
    dom.boardOverlay.hidden = false;
    dom.resultKicker.textContent = result.winner === game.playerSide ? 'VICTORY' : 'GAME OVER';
    dom.resultTitle.textContent = `${sideName(result.winner)}胜`;
    dom.resultText.textContent = resultText(result);

    dom.resultActions.replaceChildren();
    const add = (label, action, ghost = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = ghost ? 'btn-ghost' : 'btn-primary';
      button.textContent = label;
      button.addEventListener('click', action);
      dom.resultActions.append(button);
    };

    if (game.mode === 'ai') {
      add('再来一局', () => startAIGame(game.aiLevel));
      add('返回模式选择', backToMenu, true);
    } else if (game.mode === 'puzzle') {
      const won = result.winner === 'r';
      const hasNext = game.puzzleIndex + 1 < PUZZLES.length;
      if (won && hasNext) add('下一关', () => startPuzzle(game.puzzleIndex + 1));
      add(won ? '重玩本关' : '再试一次', () => startPuzzle(game.puzzleIndex));
      add('返回模式选择', backToMenu, true);
    } else if (game.mode === 'online') {
      if (online.role === 'host') {
        add('再来一局', rematchHost);
        add('关闭房间', () => leaveOnline(true), true);
      } else {
        add('请求再来一局', requestRematchGuest);
        add('离开房间', () => leaveOnline(true), true);
      }
    }
  }

  function cancelAI() {
    game.aiToken += 1;
    if (game.phase === 'thinking') {
      game.phase = 'playing';
      hideThinking();
    }
  }

  function scheduleAI() {
    if (game.mode !== 'ai' && game.mode !== 'puzzle') return;
    if (game.phase !== 'playing' || game.turn !== 'b') return;
    const token = game.aiToken + 1;
    game.aiToken = token;
    game.phase = 'thinking';
    showThinking(game.mode === 'ai' ? `AI 思考中 · ${LEVELS[game.aiLevel].name}` : 'AI 思考中');
    updateAll();

    window.setTimeout(() => {
      if (game.aiToken !== token || game.mode === 'menu' || game.phase !== 'thinking') return;
      const level = game.mode === 'puzzle'
        ? (PUZZLES[game.puzzleIndex]?.ai || 'normal')
        : game.aiLevel;
      let move = null;
      try {
        move = chooseAIMove(game.board, 'b', level);
      } catch (error) {
        move = null;
      }
      if (game.aiToken !== token) return;
      game.phase = 'playing';
      hideThinking();
      if (!move) {
        const legal = allLegalMoves(game.board, 'b');
        if (legal.length) move = legal[Math.floor(Math.random() * legal.length)];
      }
      if (!move) {
        finishGame('r', '困毙');
        return;
      }
      performMove(move.from, move.to, { ai: true });
    }, 220);
  }

  function undoMove() {
    if (game.mode === 'online' || !game.history.length) return;
    cancelAI();
    let plies = 1;
    const last = game.history[game.history.length - 1];
    if (last && last.side === 'b' && game.history.length >= 2) plies = 2;

    for (let i = 0; i < plies && game.history.length; i += 1) {
      const entry = game.history.pop();
      const board = game.board;
      board[entry.move.from.y][entry.move.from.x] = board[entry.move.to.y][entry.move.to.x];
      board[entry.move.to.y][entry.move.to.x] = entry.captured || null;
      if (entry.captured) {
        const capturedBy = entry.side;
        const list = game.captured[capturedBy];
        if (list.length) list.pop();
      }
      game.log.pop();
      game.turn = entry.side;
    }

    const lastEntry = game.history[game.history.length - 1];
    game.lastMove = lastEntry
      ? { from: lastEntry.move.from, to: lastEntry.move.to, piece: game.board[lastEntry.move.to.y][lastEntry.move.to.x], captured: lastEntry.captured }
      : null;
    game.selected = null;
    game.legal = [];
    game.result = null;
    game.phase = 'playing';
    game.check = isInCheck(game.board, game.turn);
    game.hintMove = null;
    hideResult();
    updateAll();
    toast('已悔棋');
  }

  function showPuzzleHint() {
    if (game.mode !== 'puzzle' || game.phase !== 'playing') return;
    const puzzle = PUZZLES[game.puzzleIndex];
    if (!puzzle) return;
    game.hintText = puzzle.hint;
    dom.gameStatusText.textContent = `提示：${puzzle.hint}`;
    toast('提示已显示在棋局信息中');
  }

  function resignGame() {
    if (game.phase === 'over') return;
    if (game.mode === 'online') {
      if (online.role === 'guest') {
        sendResign();
      } else {
        finishGame('b', '认输');
      }
      return;
    }
    finishGame('b', '认输');
  }

  function backToMenu() {
    cancelAI();
    if (online.active) stopOnline(true);
    game.mode = 'menu';
    game.phase = 'idle';
    game.playerSide = 'r';
    game.flipped = false;
    resetPosition(START_FEN);
    hideResult();
    hideThinking();
    showPanel('menu');
    setConnection('本地对局', 'local');
    updateAll();
  }

  function restartCurrent() {
    if (game.mode === 'ai') startAIGame(game.aiLevel);
    else if (game.mode === 'puzzle') startPuzzle(game.puzzleIndex);
    else if (game.mode === 'online') {
      if (online.role === 'host') rematchHost();
      else requestRematchGuest();
    }
  }

  /* ---------------- 联机房间 ---------------- */

  function getClientId() {
    let id = safeGet(STORE.client, '');
    if (typeof id !== 'string' || !id) {
      id = uid();
      safeSet(STORE.client, id);
    }
    return id;
  }

  function sanitizeName(value) {
    const text = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
    return text || '棋友';
  }

  function generateRoomCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function relayTopic(code = online.code) {
    return `${TOPIC_PREFIX}${code}`;
  }

  function showOnlineSetup(message = '') {
    dom.onlineSetup.hidden = false;
    dom.onlineRoom.hidden = true;
    dom.onlineError.hidden = !message;
    dom.onlineError.textContent = message;
    showPanel('online');
  }

  function showOnlineRoom() {
    dom.onlineSetup.hidden = true;
    dom.onlineRoom.hidden = false;
    dom.onlineError.hidden = true;
    updateOnlineRoom();
  }

  function updateOnlineRoom() {
    if (!online.active || !online.code) return;
    dom.roomCode.textContent = online.code;
    dom.roomStatusText.textContent = online.role === 'host'
      ? (online.guestId ? (online.status === 'finished' ? '对局结束，可在棋盘上选择再来一局' : '好友已加入，对局进行中') : '等待好友加入…把房间号发给对方')
      : (online.joined ? '已连接房主，对局进行中' : '正在连接房间…');

    dom.roomPlayers.replaceChildren();
    if (online.role === 'host') {
      dom.roomPlayers.append(makePlayerRow(online.hostName, '红方 · 房主', online.clientId === online.hostId));
      dom.roomPlayers.append(makePlayerRow(online.guestName || '等待加入…', '黑方', false));
    } else {
      dom.roomPlayers.append(makePlayerRow(online.hostName || '房主', '红方 · 房主', false));
      dom.roomPlayers.append(makePlayerRow(online.guestName || online.name || '你', '黑方', true));
    }

    if (online.role === 'host' && online.guestId && online.lastGuestSeen && Date.now() - online.lastGuestSeen > 26000 && online.status === 'playing') {
      dom.roomStatusText.textContent = '对手可能离线，棋局仍在等待…';
    }
  }

  function makePlayerRow(name, sideText, isYou) {
    const row = document.createElement('div');
    row.className = `player-row${isYou ? ' is-you' : ''}`;
    const dot = document.createElement('span');
    dot.className = `side-dot ${sideText.includes('红') ? 'red' : 'black'}`;
    const label = document.createElement('b');
    label.textContent = name;
    const side = document.createElement('span');
    side.className = 'p-side';
    side.textContent = `${sideText}${isYou ? ' · 你' : ''}`;
    row.append(dot, label, side);
    return row;
  }

  function createRoom() {
    const name = sanitizeName(dom.onlineName.value);
    safeSet(STORE.name, name);
    dom.onlineName.value = name;
    stopOnline(false);

    online.active = true;
    online.role = 'host';
    online.code = generateRoomCode();
    online.name = name;
    online.hostId = online.clientId;
    online.hostName = name;
    online.guestId = '';
    online.guestName = '';
    online.seq = 0;
    online.joined = false;
    online.status = 'waiting';
    online.error = '';
    online.lastTime = 0;
    online.lastGuestSeen = 0;

    game.mode = 'online';
    game.playerSide = 'r';
    game.flipped = false;
    resetPosition(START_FEN);
    game.phase = 'waiting';

    showPanel('online');
    showOnlineRoom();
    setStatusPill('等待中', 'is-wait');
    publishState('waiting', true);
    connectRelay();
    startRelayTimers();
    updateAll();
    toast(`房间 ${online.code} 已创建`);
  }

  function joinRoom() {
    const code = dom.roomInput.value.replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) {
      dom.onlineError.hidden = false;
      dom.onlineError.textContent = '请输入 6 位数字房间号';
      dom.roomInput.focus();
      return;
    }
    const name = sanitizeName(dom.onlineName.value);
    safeSet(STORE.name, name);
    dom.onlineName.value = name;
    stopOnline(false);

    online.active = true;
    online.role = 'guest';
    online.code = code;
    online.name = name;
    online.clientId = online.clientId || getClientId();
    online.guestId = online.clientId;
    online.guestName = name;
    online.hostId = '';
    online.hostName = '';
    online.seq = 0;
    online.joined = false;
    online.status = 'connecting';
    online.error = '';
    online.lastTime = 0;
    online.lastStateAt = 0;

    game.mode = 'online';
    game.playerSide = 'b';
    game.flipped = true;
    resetPosition(START_FEN);
    game.phase = 'waiting';

    showPanel('online');
    showOnlineRoom();
    dom.roomStatusText.textContent = '正在连接房间，请稍候…';
    setStatusPill('连接中', 'is-wait');
    connectRelay();
    startRelayTimers();
    publishJoin();
    window.clearTimeout(online.joinTimer);
      online.joinTimer = window.setTimeout(() => {
      if (!online.active || online.joined) return;
      const message = online.error || '房间不存在，或房主已离线';
      stopOnline(false);
      game.mode = 'menu';
      game.phase = 'idle';
      resetPosition(START_FEN);
      showOnlineSetup(message);
    }, 10000);
    window.setTimeout(() => { if (online.active && online.role === 'guest' && !online.joined) pollRelay(true); }, 1200);
    window.clearInterval(online.joinRetryTimer);
    online.joinRetryTimer = window.setInterval(() => {
      if (!online.active || online.role !== 'guest' || online.joined || !online.wsReady) return;
      publishJoin();
    }, 2500);
    updateAll();
  }

  function publishOnline(payload) {
    if (!online.active || !online.code) return false;
    const retain = payload.type === 'state';
    if (!online.mqtt || !online.wsReady) {
      online.outbox.push({ payload, retain });
      if (online.outbox.length > 40) online.outbox.shift();
      return false;
    }
    try {
      online.mqtt.publish(relayTopic(), JSON.stringify(payload), { qos: 1, retain });
      return true;
    } catch (error) {
      setConnection(`房间 ${online.code} · 发送失败`, 'offline');
      return false;
    }
  }

  function flushOutbox() {
    if (!online.mqtt || !online.wsReady || !online.outbox.length) return;
    const pending = online.outbox.splice(0, online.outbox.length);
    for (const item of pending) {
      try {
        online.mqtt.publish(relayTopic(), JSON.stringify(item.payload), { qos: 1, retain: item.retain });
      } catch (error) { /* ignore */ }
    }
  }

  function publishJoin() {
    if (!online.active || online.role !== 'guest') return;
    publishOnline({
      v: 1,
      type: 'join',
      sender: online.clientId,
      name: online.name,
      at: Date.now(),
    });
  }

  function buildOnlineState(status) {
    return {
      v: 1,
      code: online.code,
      hostId: online.hostId,
      hostName: online.hostName,
      guestId: online.guestId,
      guestName: online.guestName,
      fen: toFen(game.board, game.turn),
      turn: game.turn,
      seq: online.seq,
      status,
      lastMove: game.lastMove,
      log: game.log.slice(-80).map((entry) => ({ ...entry })),
      captured: { r: game.captured.r.slice(), b: game.captured.b.slice() },
      result: game.result,
      updatedAt: Date.now(),
    };
  }

  function publishState(status = online.status, bump = false) {
    if (!online.active || online.role !== 'host') return;
    if (bump) online.seq += 1;
    const safeStatus = status === 'closed' ? 'closed'
      : status === 'waiting' ? 'waiting'
        : status === 'finished' ? 'finished' : 'playing';
    const state = buildOnlineState(safeStatus);
    online.state = state;
    online.status = safeStatus;
    updateOnlineRoom();
    publishOnline({ v: 1, type: 'state', sender: online.clientId, state });
  }

  function connectRelay() {
    if (!online.active || !online.code) return;
    if (typeof mqtt === 'undefined') {
      setConnection('联机组件未加载', 'offline');
      toast('联机组件加载失败，请刷新页面');
      return;
    }
    if (online.mqtt) {
      try { online.mqtt.end(true); } catch (error) { /* ignore */ }
      online.mqtt = null;
    }
    online.wsReady = false;
    const cleanId = `cc_${String(online.clientId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}_${Math.random().toString(16).slice(2, 8)}`;
    let client;
    try {
      client = mqtt.connect(RELAY_MQTT, {
        clientId: cleanId,
        clean: true,
        reconnectPeriod: 1800,
        connectTimeout: 8000,
        protocolVersion: 4,
        keepalive: 30,
      });
    } catch (error) {
      setConnection('联机服务器连接失败', 'offline');
      return;
    }
    online.mqtt = client;

    client.on('connect', () => {
      if (online.mqtt !== client) return;
      online.wsReady = true;
      client.subscribe(relayTopic(), { qos: 1 }, (error) => {
        if (error || online.mqtt !== client) return;
        updateConnectionUI();
        flushOutbox();
        if (online.role === 'guest') {
          publishJoin();
        } else if (online.role === 'host') {
          publishState(online.status === 'waiting' ? 'waiting' : (game.phase === 'over' ? 'finished' : 'playing'), false);
        }
        updateGamePanel();
      });
    });

    client.on('message', (topic, payload) => {
      if (online.mqtt !== client || topic !== relayTopic()) return;
      let message;
      try { message = JSON.parse(payload.toString()); } catch (error) { return; }
      handleRelayMessage(message);
    });

    client.on('reconnect', () => {
      if (online.mqtt !== client) return;
      online.wsReady = false;
      updateConnectionUI();
      updateGamePanel();
    });

    client.on('close', () => {
      if (online.mqtt !== client) return;
      online.wsReady = false;
      if (!online.active) return;
      setConnection(`房间 ${online.code} · 重连中`, 'offline');
      updateGamePanel();
    });

    client.on('offline', () => {
      if (online.mqtt !== client) return;
      online.wsReady = false;
      if (online.active) setConnection(`房间 ${online.code} · 等待网络`, 'offline');
    });

    client.on('error', () => {
      if (online.mqtt !== client) return;
      setConnection(`房间 ${online.code} · 连接异常`, 'offline');
    });
  }

  function startRelayTimers() {
    stopRelayTimers();
    online.heartbeatTimer = window.setInterval(() => {
      if (!online.active || online.role !== 'host' || !online.wsReady) return;
      const status = game.phase === 'over' ? 'finished' : (online.status === 'waiting' ? 'waiting' : 'playing');
      publishState(status, false);
    }, 15000);

    online.pingTimer = window.setInterval(() => {
      if (!online.active || online.role !== 'guest' || !online.wsReady) return;
      publishOnline({ v: 1, type: 'ping', sender: online.clientId, at: Date.now() });
    }, 10000);
  }

  function stopRelayTimers() {
    window.clearInterval(online.heartbeatTimer);
    window.clearInterval(online.pingTimer);
    window.clearInterval(online.pollTimer);
    window.clearInterval(online.catchupTimer);
    window.clearTimeout(online.reconnectTimer);
    window.clearTimeout(online.joinTimer);
    window.clearTimeout(online.activeTimer);
    window.clearInterval(online.joinRetryTimer);
    clearSyncTimers();
    online.heartbeatTimer = null;
    online.pingTimer = null;
    online.pollTimer = null;
    online.catchupTimer = null;
    online.reconnectTimer = null;
    online.joinTimer = null;
    online.activeTimer = null;
    online.joinRetryTimer = null;
  }

  function startFallbackPolling() { /* MQTT keeps a live subscription; no poll needed. */ }
  function stopFallbackPolling() { /* compatibility no-op */ }

  async function pollRelay() { /* retained MQTT state is delivered on subscribe; no polling. */ }

  function handleRelayMessage(message) {
    if (!message || message.v !== 1 || !online.active) return;
    if (online.role === 'host') handleHostMessage(message);
    else if (online.role === 'guest') handleGuestMessage(message);
  }

  function handleHostMessage(message) {
    if (message.sender === online.clientId && message.type !== 'state') return;

    if (message.type === 'join') {
      const guest = message.sender;
      if (!guest || guest === online.clientId) return;
      online.lastGuestSeen = Date.now();
      if (!online.guestId && online.status === 'waiting') {
        online.guestId = guest;
        online.guestName = sanitizeName(message.name);
        online.joined = true;
        game.mode = 'online';
        game.playerSide = 'r';
        game.flipped = false;
        resetPosition(START_FEN);
        game.phase = 'playing';
        online.status = 'playing';
        showPanel('game');
        publishState('playing', true);
        updateAll();
        audio.notify();
        toast(`${online.guestName} 加入了房间`);
      } else if (online.guestId === guest) {
        publishState(online.status === 'finished' ? 'finished' : 'playing', false);
      } else {
        publishState(online.status === 'finished' ? 'finished' : (online.status === 'waiting' ? 'waiting' : 'playing'), false);
      }
      return;
    }

    if (message.type === 'ping') {
      if (message.sender === online.guestId) online.lastGuestSeen = Date.now();
      return;
    }

    if (message.sender !== online.guestId) return;

    if (message.type === 'move') {
      online.lastGuestSeen = Date.now();
      if (online.status !== 'playing' || game.phase !== 'playing' || game.turn !== 'b') {
        publishState(online.status === 'finished' ? 'finished' : 'playing', false);
        return;
      }
      if (Number(message.baseSeq) !== online.seq) {
        publishState('playing', false);
        return;
      }
      const from = message.from;
      const to = message.to;
      if (!from || !to || !Number.isInteger(from.x) || !Number.isInteger(from.y) || !Number.isInteger(to.x) || !Number.isInteger(to.y)) {
        publishState('playing', false);
        return;
      }
      const ok = performMove(from, to, { remote: true });
      if (!ok) publishState('playing', false);
      return;
    }

    if (message.type === 'resign') {
      if (online.status === 'playing') finishGame('r', '认输');
      return;
    }

    if (message.type === 'sync') {
      publishState(online.status === 'finished' ? 'finished' : (online.status === 'waiting' ? 'waiting' : 'playing'), false);
      return;
    }

    if (message.type === 'leave') {
      online.guestId = '';
      online.guestName = '';
      online.joined = false;
      online.status = 'waiting';
      resetPosition(START_FEN);
      game.mode = 'online';
      game.phase = 'waiting';
      game.playerSide = 'r';
      game.flipped = false;
      showPanel('online');
      showOnlineRoom();
      publishState('waiting', true);
      updateAll();
      toast('对手已离开房间');
      return;
    }

    if (message.type === 'rematch') {
      if (online.status === 'finished') rematchHost();
    }
  }

  function handleGuestMessage(message) {
    if (message.type !== 'state' || !message.state) return;
    const state = message.state;
    if (!state || state.code !== online.code) return;
    if (state.hostId && message.sender && message.sender !== state.hostId) return;
    if (online.hostId && message.sender !== online.hostId) return;
    if (state.updatedAt && Date.now() - state.updatedAt > 12 * 60 * 1000) return;

    if (state.status === 'closed') {
      toast('房主已关闭房间');
      leaveOnline(false);
      return;
    }

    if (state.guestId && state.guestId !== online.clientId) {
      if (!online.joined) {
        const message = '房间已满，请换一个房间号';
        online.error = message;
        stopOnline(false);
        game.mode = 'menu';
        game.phase = 'idle';
        resetPosition(START_FEN);
        showOnlineSetup(message);
      }
      return;
    }

    if (!state.guestId) {
      if (!online.joined) {
        dom.roomStatusText.textContent = '房主已收到请求，正在准备棋局…';
      }
      return;
    }

    if (!online.joined) {
      online.joined = true;
      online.hostId = state.hostId;
      online.hostName = state.hostName;
      online.guestId = state.guestId;
      online.guestName = state.guestName;
      online.status = state.status;
      online.seq = state.seq;
      window.clearTimeout(online.joinTimer);
      window.clearInterval(online.joinRetryTimer);
      showPanel('game');
      applyOnlineState(state);
      toast(`已加入 ${online.hostName} 的房间`);
      audio.notify();
      return;
    }

    if (Number(state.seq) < online.seq) return;
    if (online.movePending && Number(state.seq) <= online.seq) return;
    if (!online.movePending && Number(state.seq) === online.seq) {
      online.lastStateAt = Date.now();
      return;
    }
    online.status = state.status;
    applyOnlineState(state);
  }

  function applyOnlineState(state) {
    if (!state || state.code !== online.code) return;
    let parsed;
    try {
      parsed = parseFen(state.fen);
    } catch (error) {
      return;
    }

    game.mode = 'online';
    game.playerSide = 'b';
    game.flipped = true;
    game.board = parsed.board;
    game.turn = state.turn === 'b' ? 'b' : 'r';
    game.selected = null;
    game.legal = [];
    game.history = [];
    game.lastMove = state.lastMove || null;
    game.log = Array.isArray(state.log) ? state.log.slice(-80) : [];
    game.captured = {
      r: Array.isArray(state.captured?.r) ? state.captured.r.slice() : [],
      b: Array.isArray(state.captured?.b) ? state.captured.b.slice() : [],
    };
    game.result = state.result || null;
    game.check = isInCheck(game.board, game.turn);
    game.phase = game.result ? 'over' : 'playing';
    game.hintMove = null;
    game.hintText = '';
    online.seq = Number(state.seq) || 0;
    online.movePending = false;
    window.clearTimeout(online.activeTimer);
    clearSyncTimers();
    online.lastStateAt = Date.now();
    online.status = state.status;

    if (!online.joined) {
      online.joined = true;
      online.hostId = state.hostId;
      online.hostName = state.hostName;
      online.guestId = state.guestId;
      online.guestName = state.guestName;
      showPanel('game');
    }

    updateAll();
    if (game.result) handleGameOver();
    else hideResult();
  }

  function sendGuestMove(from, to) {
    if (!online.active || online.role !== 'guest' || !online.joined) return;
    if (online.status !== 'playing' || game.phase !== 'playing' || game.turn !== 'b') return;
    if (online.movePending) return;
    if (!isLegalTarget(game.board, from, to)) return;
    const piece = game.board[from.y][from.x];
    if (!piece || sideOf(piece) !== 'b') return;

    online.movePending = true;
    online.pendingMove = { from: { ...from }, to: { ...to } };
    publishOnline({
      v: 1,
      type: 'move',
      sender: online.clientId,
      baseSeq: online.seq,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      at: Date.now(),
    });
    updateGamePanel();
    queueRender();
    clearSyncTimers();
    for (const delay of [1200, 3200, 5600]) {
      online.syncTimers.push(window.setTimeout(() => {
        if (!online.active || !online.movePending) return;
        publishOnline({ v: 1, type: 'sync', sender: online.clientId, at: Date.now() });
        pollRelay(false);
      }, delay));
    }
    window.clearTimeout(online.activeTimer);
    online.activeTimer = window.setTimeout(() => {
      if (!online.active || !online.movePending) return;
      online.movePending = false;
      updateGamePanel();
      toast('同步超时，请重新走子');
    }, 6000);
  }

  function sendResign() {
    if (!online.active || online.role !== 'guest') return;
    publishOnline({ v: 1, type: 'resign', sender: online.clientId, at: Date.now() });
    dom.gameStatusText.textContent = '已认输，等待房主确认…';
    dom.onlineResignBtn.disabled = true;
    clearSyncTimers();
    for (const delay of [1200, 3200]) {
      online.syncTimers.push(window.setTimeout(() => {
        if (!online.active || game.phase === 'over') return;
        publishOnline({ v: 1, type: 'sync', sender: online.clientId, at: Date.now() });
        pollRelay(false);
      }, delay));
    }
  }

  function requestRematchGuest() {
    if (!online.active || online.role !== 'guest') return;
    publishOnline({ v: 1, type: 'rematch', sender: online.clientId, at: Date.now() });
    toast('已请求再来一局，等待房主开始');
  }

  function clearSyncTimers() {
    for (const timer of online.syncTimers) window.clearTimeout(timer);
    online.syncTimers = [];
  }

  function rematchHost() {
    if (!online.active || online.role !== 'host') return;
    resetPosition(START_FEN);
    game.mode = 'online';
    game.playerSide = 'r';
    game.flipped = false;
    game.phase = 'playing';
    online.status = 'playing';
    online.joined = true;
    hideResult();
    showPanel('game');
    publishState('playing', true);
    updateAll();
    toast('新对局开始');
  }

  function leaveOnline(notify = true) {
    if (online.active) stopOnline(notify);
    game.mode = 'menu';
    game.phase = 'idle';
    game.playerSide = 'r';
    game.flipped = false;
    resetPosition(START_FEN);
    hideResult();
    hideThinking();
    showPanel('menu');
    setConnection('本地对局', 'local');
    updateAll();
  }

  function stopOnline(notify = true) {
    if (!online.active) {
      resetOnlineFields();
      return;
    }
    if (notify && online.code) {
      if (online.role === 'host') {
        online.seq += 1;
        const state = buildOnlineState('closed');
        publishOnline({ v: 1, type: 'state', sender: online.clientId, state });
      } else if (online.role === 'guest') {
        publishOnline({ v: 1, type: 'leave', sender: online.clientId, at: Date.now() });
      }
    }
    if (online.ws) {
      try { online.ws.close(); } catch (error) { /* ignore */ }
      online.ws = null;
    }
    const client = online.mqtt;
    online.mqtt = null;
    online.wsReady = false;
    stopRelayTimers();
    stopFallbackPolling();
    if (client) {
      window.setTimeout(() => {
        try { client.end(true); } catch (error) { /* ignore */ }
      }, 350);
    }
    resetOnlineFields();
    setConnection('本地对局', 'local');
  }

  function resetOnlineFields() {
    online.active = false;
    online.role = null;
    online.code = '';
    online.guestId = '';
    online.guestName = '';
    online.hostId = '';
    online.hostName = '';
    online.seq = 0;
    online.joined = false;
    online.ws = null;
    online.mqtt = null;
    online.outbox = [];
    online.wsReady = false;
    online.lastTime = 0;
    online.lastStateAt = 0;
    online.lastGuestSeen = 0;
    online.status = 'idle';
    online.error = '';
    online.state = null;
    online.polling = false;
    online.movePending = false;
    online.pendingMove = null;
    online.syncTimers = [];
    online.joinRetryTimer = null;
    online.error = '';
  }

  /* ---------------- 事件绑定 / 启动 ---------------- */

  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (mode === 'ai') {
          showPanel('ai');
          updateLevelUI();
        } else if (mode === 'online') {
          showOnlineSetup();
          setOnlineTab('create');
        } else if (mode === 'puzzle') {
          showPanel('puzzle');
          renderPuzzleList();
        }
      });
    });

    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', backToMenu);
    });

    dom.levelGrid.querySelectorAll('[data-level]').forEach((button) => {
      button.addEventListener('click', () => {
        game.aiLevel = button.dataset.level;
        updateLevelUI();
      });
    });

    dom.aiStartBtn.addEventListener('click', () => startAIGame(game.aiLevel));

    document.querySelectorAll('[data-online-tab]').forEach((tab) => {
      tab.addEventListener('click', () => setOnlineTab(tab.dataset.onlineTab));
    });

    dom.createRoomBtn.addEventListener('click', createRoom);
    dom.joinRoomBtn.addEventListener('click', joinRoom);
    dom.roomInput.addEventListener('input', () => {
      dom.roomInput.value = dom.roomInput.value.replace(/\D/g, '').slice(0, 6);
    });
    dom.roomInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') joinRoom();
    });

    dom.copyCodeBtn.addEventListener('click', async () => {
      if (!online.code) return;
      const ok = await copyText(online.code);
      toast(ok === false ? '复制失败，请手动选择房间号' : `房间号 ${online.code} 已复制`);
    });

    dom.copyLinkBtn.addEventListener('click', async () => {
      if (!online.code) return;
      const base = location.href.split('?')[0];
      const link = `${base}?room=${online.code}`;
      const ok = await copyText(link);
      toast(ok === false ? '复制失败' : '邀请链接已复制');
    });

    dom.gameCopyCode.addEventListener('click', async () => {
      if (!online.code) return;
      const ok = await copyText(online.code);
      toast(ok === false ? '复制失败' : '房间号已复制');
    });

    dom.leaveRoomBtn.addEventListener('click', () => leaveOnline(true));
    dom.onlineLeaveBtn.addEventListener('click', () => leaveOnline(true));
    dom.onlineResignBtn.addEventListener('click', resignGame);
    dom.resignBtn.addEventListener('click', resignGame);
    dom.undoBtn.addEventListener('click', undoMove);
    dom.hintBtn.addEventListener('click', showPuzzleHint);
    dom.backBtn.addEventListener('click', backToMenu);

    dom.canvas.addEventListener('click', handleBoardClick);
    dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    dom.soundBtn.addEventListener('click', () => {
      audio.muted = !audio.muted;
      safeSet(STORE.muted, audio.muted);
      updateSoundUI();
      if (!audio.muted) audio.notify();
    });

    dom.helpBtn.addEventListener('click', () => {
      dom.helpModal.hidden = false;
    });
    dom.helpModal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => { dom.helpModal.hidden = true; });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dom.helpModal.hidden) {
        dom.helpModal.hidden = true;
      }
    });

    dom.onlineName.addEventListener('input', () => {
      dom.onlineName.value = dom.onlineName.value.slice(0, 10);
    });

    window.addEventListener('resize', resizeCanvas);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(dom.boardFrame);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => resizeCanvas()).catch(() => {});
    }

    window.addEventListener('pagehide', () => {
      if (!online.active || !online.mqtt) return;
      try {
        if (online.role === 'host') {
          online.seq += 1;
          const state = buildOnlineState('closed');
          online.mqtt.publish(relayTopic(), JSON.stringify({ v: 1, type: 'state', sender: online.clientId, state }), { qos: 1, retain: true });
        } else if (online.role === 'guest') {
          online.mqtt.publish(relayTopic(), JSON.stringify({ v: 1, type: 'leave', sender: online.clientId, at: Date.now() }), { qos: 1, retain: false });
        }
      } catch (error) { /* ignore */ }
    });
  }

  function updateLevelUI() {
    dom.levelGrid.querySelectorAll('[data-level]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.level === game.aiLevel);
    });
    dom.levelNote.textContent = LEVELS[game.aiLevel]?.note || '';
  }

  function setOnlineTab(tab) {
    document.querySelectorAll('[data-online-tab]').forEach((button) => {
      const active = button.dataset.onlineTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    dom.createPane.hidden = tab !== 'create';
    dom.joinPane.hidden = tab !== 'join';
    dom.onlineError.hidden = true;
  }

  function init() {
    const params = new URLSearchParams(location.search);
    online.clientId = params.get('debug') === '1' && params.get('client')
      ? String(params.get('client'))
      : getClientId();
    online.name = safeGet(STORE.name, '棋友') || '棋友';
    dom.onlineName.value = online.name;
    updateSoundUI();
    renderPuzzleList();
    updateLevelUI();
    buildWood();
    resetPosition(START_FEN);
    game.mode = 'menu';
    game.phase = 'idle';
    showPanel('menu');
    bindEvents();
    updateAll();
    window.requestAnimationFrame(() => resizeCanvas());

    const room = (params.get('room') || '').replace(/\D/g, '').slice(0, 6);
    if (room.length === 6) {
      showPanel('online');
      showOnlineSetup();
      setOnlineTab('join');
      dom.roomInput.value = room;
      dom.roomInput.focus();
    }

    if (params.get('debug') === '1') {
      window.__ccDebug = {
        snapshot: () => ({
          mode: game.mode,
          phase: game.phase,
          turn: game.turn,
          playerSide: game.playerSide,
          fen: toFen(game.board, game.turn),
          check: game.check,
          result: game.result,
          history: game.history.length,
          log: game.log.slice(),
          selected: game.selected,
          legal: game.legal.slice(),
          online: {
            active: online.active,
            role: online.role,
            code: online.code,
            seq: online.seq,
            joined: online.joined,
            status: online.status,
            wsReady: online.wsReady,
            guestId: online.guestId,
            hostId: online.hostId,
            movePending: online.movePending,
          },
        }),
        startAI: (level = 'normal') => { startAIGame(level); return true; },
        startPuzzle: (index = 0) => { startPuzzle(Number(index)); return true; },
        move: (fx, fy, tx, ty) => {
          const from = { x: Number(fx), y: Number(fy) };
          const to = { x: Number(tx), y: Number(ty) };
          if (game.mode === 'online' && online.role === 'guest') {
            sendGuestMove(from, to);
            return true;
          }
          return performMove(from, to);
        },
        legal: (x, y) => legalMovesFrom(game.board, Number(x), Number(y)),
        moves: (side = 'r') => allLegalMoves(game.board, side).map((m) => m.from.x + ',' + m.from.y + '-' + m.to.x + ',' + m.to.y),
        select: (x, y) => { selectCell({ x: Number(x), y: Number(y) }); return true; },
        click: (x, y) => { handleBoardClick({ clientX: 0, clientY: 0 }); return true; },
        createRoom: (name = '房主') => { dom.onlineName.value = name; createRoom(); return true; },
        joinRoom: (code, name = '棋友') => { dom.onlineName.value = name; dom.roomInput.value = code; joinRoom(); return true; },
        leaveOnline: () => { leaveOnline(true); return true; },
        stopOnline: () => { stopOnline(false); return true; },
        poll: () => pollRelay(true),
        rematch: () => {
          if (online.role === 'host') rematchHost(); else requestRematchGuest();
          return true;
        },
        resign: () => { resignGame(); return true; },
        setBoard: (fen, turn = 'r') => {
          const parsed = parseFen(fen);
          game.board = parsed.board;
          game.turn = turn === 'b' ? 'b' : 'r';
          game.check = isInCheck(game.board, game.turn);
          game.selected = null;
          game.legal = [];
          updateAll();
          return true;
        },
        setPosition: (fen, turn = 'r') => {
          const parsed = parseFen(fen);
          game.board = parsed.board;
          game.turn = turn === 'b' ? 'b' : 'r';
          game.selected = null;
          game.legal = [];
          game.lastMove = null;
          game.history = [];
          game.log = [];
          game.captured = { r: [], b: [] };
          game.result = null;
          game.phase = 'playing';
          game.check = isInCheck(game.board, game.turn);
          game.mode = game.mode === 'menu' ? 'online' : game.mode;
          hideResult();
          updateAll();
          queueRender();
          return true;
        },
        check: (side = 'r') => isInCheck(game.board, side),
        aiMove: (level = 'normal', side = 'b') => {
          const started = now();
          const move = chooseAIMove(game.board, side, level);
          return { move, ms: Math.round(now() - started) };
        },
        validatePuzzles: () => PUZZLES.map((puzzle, index) => {
          try {
            const parsed = parseFen(puzzle.fen);
            return {
              index: index + 1,
              name: puzzle.name,
              rows: parsed.board.length,
              redCheck: isInCheck(parsed.board, 'r'),
              blackCheck: isInCheck(parsed.board, 'b'),
              redMoves: allLegalMoves(parsed.board, 'r').length,
              blackMoves: allLegalMoves(parsed.board, 'b').length,
              kings: Boolean(findKing(parsed.board, 'r') && findKing(parsed.board, 'b')),
            };
          } catch (error) {
            return { index: index + 1, name: puzzle.name, error: String(error) };
          }
        }),
        finish: (winner = 'r', reason = '测试') => { finishGame(winner, reason); return true; },
        board: () => game.board.map((row) => row.slice()),
        onlineState: () => online.state,
      };
    }
  }

  init();
})();




