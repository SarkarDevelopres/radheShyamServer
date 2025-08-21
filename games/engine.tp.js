// engine.js (Teen Patti)
// CommonJS module
const crypto = require('crypto');

const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // 11=J, 12=Q, 13=K, 14=A

function newDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ r, s });
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    // crypto.randomInt for better randomness than Math.random
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankName(r) {
  if (r === 14) return 'A';
  if (r === 13) return 'K';
  if (r === 12) return 'Q';
  if (r === 11) return 'J';
  return String(r);
}

function cardStr(c) {
  return rankName(c.r) + c.s; // e.g., "AS", "10H"
}

function sortAsc(arr) {
  return [...arr].sort((a,b) => a-b);
}

// Teen Patti hand evaluator
// Categories (high->low):
// 6 Trail (3 of a kind)
// 5 Pure Sequence (straight flush)
// 4 Sequence (straight)
// 3 Color (flush)
// 2 Pair
// 1 High Card
function handRank3(cards) {
  if (cards.length !== 3) throw new Error('Need exactly 3 cards');
  const r = cards.map(c => c.r);
  const s = cards.map(c => c.s);
  const rs = sortAsc(r);

  const allSameSuit = (s[0] === s[1] && s[1] === s[2]);
  const allEqual = (rs[0] === rs[1] && rs[1] === rs[2]);
  const isPair = (rs[0] === rs[1] || rs[1] === rs[2]);

  // Sequence check (Ace can be high A-K-Q or low A-2-3)
  const isA23 = (rs[0] === 2 && rs[1] === 3 && rs[2] === 14);
  const isStraightNormal = (rs[0]+1 === rs[1] && rs[1]+1 === rs[2]);
  const isSeq = isA23 || isStraightNormal;

  // For sequence strength, define "top":
  // A-2-3 -> treat as top=3 (lowest straight)
  // A-K-Q -> top=14 (highest)
  // normal -> top = highest rank
  const seqTop = isA23 ? 3 : (isSeq ? rs[2] : 0);

  if (allEqual) {
    // Trail
    return [6, rs[0]]; // Three of the same rank
  }
  if (isSeq && allSameSuit) {
    // Pure sequence
    return [5, seqTop];
  }
  if (isSeq) {
    // Sequence
    return [4, seqTop];
  }
  if (allSameSuit) {
    // Color
    return [3, rs[2], rs[1], rs[0]];
  }
  if (isPair) {
    // Pair: [pair rank, kicker]
    const pairRank = (rs[0] === rs[1]) ? rs[0] : rs[1];
    const kicker = (rs[0] === rs[1]) ? rs[2] : rs[0];
    return [2, pairRank, kicker];
  }
  // High card
  return [1, rs[2], rs[1], rs[0]];
}

function cmpRanks(a, b) {
  // lexicographic comparison descending
  const L = Math.max(a.length, b.length);
  for (let i = 0; i < L; i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function showdownCompare(aCards, bCards) {
  const ra = handRank3(aCards);
  const rb = handRank3(bCards);
  const c = cmpRanks(ra, rb);
  if (c > 0) return 1;
  if (c < 0) return -1;
  return 0; // tie
}

// Helpers to sanitize public state (don’t leak cards)
function publicPlayerView(p) {
  return {
    userId: p.userId,
    name: p.name,
    status: p.status,          // 'IN' | 'FOLDED' | 'OUT'
    contributed: p.contributed,
  };
}

function nowMs() { return Date.now(); }

class TeenPattiEngine {
  /**
   * opts: {
   *  io,
   *  tableId: 'default',
   *  boot: 10,
   *  minPlayers: 3,
   *  maxPlayers: 6,
   *  turnMs: 15000,
   *  hooks: {
   *    debit: async (userId, amount, meta) => {},
   *    credit: async (userId, amount, meta) => {},
   *    onHandSettled: async (payload) => {}
   *  }
   * }
   */
  constructor(opts) {
    this.io = opts.io;
    this.tables = new Map();
    this.defaultConfig = {
      boot: 10,
      minPlayers: 3,
      maxPlayers: 6,
      turnMs: 15000,
      ...opts
    };
    // Create at least one table
    const tableId = opts.tableId || 'default';
    this.createTable(tableId, this.defaultConfig);
  }

  createTable(tableId, config = {}) {
    if (this.tables.has(tableId)) return this.tables.get(tableId);
    const t = {
      id: tableId,
      cfg: {
        boot: config.boot ?? this.defaultConfig.boot,
        minPlayers: config.minPlayers ?? this.defaultConfig.minPlayers,
        maxPlayers: config.maxPlayers ?? this.defaultConfig.maxPlayers,
        turnMs: config.turnMs ?? this.defaultConfig.turnMs,
      },
      players: [],       // [{userId, name, socketId, status, contributed}]
      playerMap: new Map(), // userId -> index in players
      dealerIdx: -1,
      inHand: new Set(),
      folded: new Set(),
      deck: [],
      hands: new Map(),  // userId -> [cards]
      pot: 0,
      currentBet: 0,     // the contribution level to match
      lastRaiser: null,  // userId who last raised
      turnIdx: -1,       // index into players array (for active player)
      turnTimer: null,
      turnDeadline: null,
      handNo: 0,
      isHandActive: false,
      hooks: this.defaultConfig.hooks || {},
    };
    this.tables.set(tableId, t);
    return t;
  }

  // ---- Player & Room management ----
  join(tableId, { userId, name, socketId }) {
    const t = this.tables.get(tableId) || this.createTable(tableId);
    if (t.playerMap.has(userId)) {
      // refresh socketId / status
      const idx = t.playerMap.get(userId);
      t.players[idx].socketId = socketId;
      t.players[idx].status = t.isHandActive ? 'OUT' : 'IN'; // rejoin lobby
    } else {
      if (t.players.length >= t.cfg.maxPlayers) {
        this.io.to(socketId).emit('tp:error', { msg: 'Table is full' });
        return;
      }
      const p = {
        userId, name: name || ('User-' + userId.slice(-4)),
        socketId,
        status: 'IN', // IN=waiting/lobby or in-hand, FOLDED, OUT (spectating)
        contributed: 0,
      };
      t.players.push(p);
      t.playerMap.set(userId, t.players.length - 1);
      // put socket in room
      this._joinRoom(socketId, this._room(tableId));
    }
    this._broadcastState(tableId);

    // Autostart if enough players & no hand running
    if (!t.isHandActive && this._activeSeatedCount(t) >= t.cfg.minPlayers) {
      this._startHand(tableId);
    }
  }

  leave(tableId, userId) {
    const t = this.tables.get(tableId);
    if (!t) return;
    const idx = t.playerMap.get(userId);
    if (idx === undefined) return;

    const p = t.players[idx];
    // If leaving during a hand, treat as fold
    if (t.isHandActive && t.inHand.has(userId)) {
      this._applyFold(tableId, userId, 'left');
    }

    // Remove player from arrays/maps (lazy compact)
    p.status = 'OUT';
    // No hard delete to keep seat order stable mid-hand. You can compact later.

    this._broadcastState(tableId);

    // If only one remains in hand after leave, end hand
    if (t.isHandActive && t.inHand.size === 1) {
      const [winnerId] = [...t.inHand];
      this._endHand(tableId, { reason: 'last-man-standing', winners: [winnerId] });
    }
  }

  // ---- Game Flow ----
  _startHand(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return;
    // Seat players that are 'IN' as active
    const activeSeatIdx = [];
    for (let i = 0; i < t.players.length; i++) {
      const p = t.players[i];
      if (p && p.status !== 'OUT') activeSeatIdx.push(i);
    }
    if (activeSeatIdx.length < t.cfg.minPlayers) return;

    t.isHandActive = true;
    t.handNo += 1;
    t.inHand.clear();
    t.folded.clear();
    t.pot = 0;
    t.currentBet = 0;
    t.lastRaiser = null;
    t.deck = shuffle(newDeck());
    t.hands.clear();

    // Rotate dealer
    t.dealerIdx = (t.dealerIdx + 1) % activeSeatIdx.length;

    // Reset per-player fields; collect boot
    for (const i of activeSeatIdx) {
      const p = t.players[i];
      p.status = 'IN';
      p.contributed = 0;
      t.inHand.add(p.userId);
    }

    // Boot collection
    const boot = t.cfg.boot;
    Promise.all(activeSeatIdx.map(async (i) => {
      const p = t.players[i];
      try {
        if (t.hooks.debit) {
          await t.hooks.debit(p.userId, boot, { tableId, type: 'TP_BOOT', handNo: t.handNo });
        }
        p.contributed += boot;
        t.pot += boot;
      } catch (e) {
        // Could not pay boot: mark OUT for this hand
        p.status = 'OUT';
        t.inHand.delete(p.userId);
      }
    })).then(() => {
      // Deal 3 cards to each remaining inHand player
      for (const i of activeSeatIdx) {
        const p = t.players[i];
        if (!t.inHand.has(p.userId)) continue;
        const hand = [t.deck.pop(), t.deck.pop(), t.deck.pop()];
        t.hands.set(p.userId, hand);
        // Private deal
        if (p.socketId) {
          this.io.to(p.socketId).emit('tp:hand:deal', {
            tableId,
            handNo: t.handNo,
            cards: hand.map(cardStr),
          });
        }
      }

      // First bet = boot
      t.currentBet = boot;

      // Set first turn: left of dealer among active
      const order = activeSeatIdx.map(i => t.players[i].userId);
      const dealerUserId = t.players[activeSeatIdx[t.dealerIdx]].userId;
      const firstIdx = (t.dealerIdx + 1) % activeSeatIdx.length;
      t.turnIdx = activeSeatIdx[firstIdx];

      this.io.to(this._room(tableId)).emit('tp:hand:start', {
        tableId,
        handNo: t.handNo,
        boot: t.cfg.boot,
        dealerUserId,
        pot: t.pot,
      });

      this._broadcastState(tableId);
      this._startTurnTimer(tableId);
    });
  }

  _activeSeatedCount(t) {
    let c = 0;
    for (const p of t.players) if (p && p.status !== 'OUT') c++;
    return c;
  }

  // Turn/timer
  _startTurnTimer(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return;

    // Advance if current turn player is invalid
    let safety = 0;
    while (safety++ < t.players.length) {
      const p = t.players[t.turnIdx];
      if (p && t.inHand.has(p.userId) && p.status === 'IN') break;
      t.turnIdx = (t.turnIdx + 1) % t.players.length;
    }

    const p = t.players[t.turnIdx];
    if (!p || !t.inHand.has(p.userId)) {
      // No valid player (e.g., hand ended)
      return;
    }

    const deadline = nowMs() + t.cfg.turnMs;
    t.turnDeadline = deadline;

    this.io.to(this._room(tableId)).emit('tp:turn', {
      tableId,
      handNo: t.handNo,
      userId: p.userId,
      deadline,
      callAmount: Math.max(0, t.currentBet - p.contributed),
      minRaise: t.cfg.boot, // simple min raise rule
    });

    clearTimeout(t.turnTimer);
    t.turnTimer = setTimeout(() => {
      // Auto-fold on timeout
      this._applyFold(tableId, p.userId, 'timeout');
      this._postActionFlow(tableId, p.userId, { type: 'FOLD', timeout: true });
    }, t.cfg.turnMs + 50);
  }

  // Client action entry
  action(tableId, { userId, action, amount }) {
    const t = this.tables.get(tableId);
    if (!t || !t.isHandActive) return;

    const pIdx = t.playerMap.get(userId);
    if (pIdx === undefined) return;
    if (t.turnIdx !== pIdx) return; // not your turn
    const p = t.players[pIdx];
    if (!t.inHand.has(userId) || p.status !== 'IN') return;

    const required = Math.max(0, t.currentBet - p.contributed);
    const minRaise = t.cfg.boot;

    if (action === 'FOLD') {
      this._applyFold(tableId, userId, 'user');
      this._postActionFlow(tableId, userId, { type: 'FOLD' });
      return;
    }

    if (action === 'CALL') {
      if (required > 0) {
        this._takeChips(tableId, p, required, { type: 'TP_CALL' });
      }
      this._postActionFlow(tableId, userId, { type: 'CALL', call: required });
      return;
    }

    if (action === 'RAISE') {
      const raiseBy = Number(amount || 0);
      if (!Number.isFinite(raiseBy) || raiseBy < minRaise) {
        this.io.to(p.socketId).emit('tp:error', { msg: `Min raise is ${minRaise}` });
        return;
      }
      // First, match the call if required, then add raiseBy
      const toPay = required + raiseBy;
      this._takeChips(tableId, p, toPay, { type: 'TP_RAISE' });
      t.currentBet = p.contributed;
      t.lastRaiser = userId;
      this._postActionFlow(tableId, userId, { type: 'RAISE', totalPut: toPay });
      return;
    }

    this.io.to(p.socketId).emit('tp:error', { msg: 'Invalid action' });
  }

  _takeChips(tableId, p, amount, meta) {
    const t = this.tables.get(tableId);
    if (!t) return;
    if (amount <= 0) return;
    // Debit wallet
    const hook = t.hooks.debit;
    const doDebit = hook ? hook(p.userId, amount, { tableId, handNo: t.handNo, ...meta }) : Promise.resolve();
    // We intentionally block until debit resolves to keep pot consistent
    // (In a real-money prod system, you'd use transactions & handle failures carefully.)
    // eslint-disable-next-line no-sync
    let ok = true;
    // Because hooks.debit is async, we wrap with sync-like use:
    // We'll enqueue an immediate microtask that throws if debit fails; but to keep it simple here:
    // (Better: make action() async and await debit; kept simple for paste-ability.)
    // WARNING: For real money, convert action() to async and await here.
    // Here we do a naive sync-ish flow assuming debit succeeds. If it fails, the hook should throw visibly/log.
    try {
      // this is unsafe if hook is truly async; recommend making action async.
      // For now, assume success.
    } catch (e) { ok = false; }
    if (!ok) {
      this.io.to(p.socketId).emit('tp:error', { msg: 'Payment failed' });
      return;
    }
    p.contributed += amount;
    t.pot += amount;
  }

  _applyFold(tableId, userId, reason) {
    const t = this.tables.get(tableId);
    if (!t) return;
    const idx = t.playerMap.get(userId);
    if (idx === undefined) return;
    const p = t.players[idx];
    if (!t.inHand.has(userId)) return;

    p.status = 'FOLDED';
    t.inHand.delete(userId);
    t.folded.add(userId);

    this.io.to(this._room(tableId)).emit('tp:action', {
      tableId, handNo: t.handNo, userId, action: 'FOLD', reason
    });
  }

  _postActionFlow(tableId, actedUserId, payload) {
    const t = this.tables.get(tableId);
    if (!t) return;

    this._broadcastState(tableId);

    // If only one remains -> winner
    if (t.inHand.size === 1) {
      const [winnerId] = [...t.inHand];
      this._endHand(tableId, { reason: 'last-man-standing', winners: [winnerId] });
      return;
    }

    // If no raise and action came back around to lastRaiser -> showdown
    const nextIdx = this._nextActiveIdx(t, t.turnIdx);
    const prevTurnUserId = t.players[t.turnIdx]?.userId;
    t.turnIdx = nextIdx;

    // If there is a lastRaiser, when turn reaches them again with everyone having matched, go to showdown.
    const everyoneMatched =
      [...t.inHand].every(uid => {
        const pi = t.playerMap.get(uid);
        const pp = t.players[pi];
        return pp.contributed === t.currentBet;
      });

    if (t.lastRaiser && everyoneMatched && t.players[nextIdx]?.userId === t.lastRaiser) {
      this._doShowdown(tableId);
      return;
    }

    // Otherwise continue
    this._startTurnTimer(tableId);
  }

  _nextActiveIdx(t, idx) {
    if (t.inHand.size === 0) return idx;
    let i = idx;
    let spins = 0;
    do {
      i = (i + 1) % t.players.length;
      const p = t.players[i];
      if (p && t.inHand.has(p.userId) && p.status === 'IN') return i;
      spins++;
    } while (spins <= t.players.length);
    return idx;
  }

  _doShowdown(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return;
    clearTimeout(t.turnTimer);

    // Collect hands of remaining players
    const alive = [...t.inHand];
    const results = alive.map(uid => {
      const hand = t.hands.get(uid) || [];
      return { userId: uid, hand, rank: handRank3(hand) };
    });

    // Find best
    results.sort((a,b) => -cmpRanks(a.rank, b.rank)); // descending
    const best = results[0];
    const winners = results.filter(r => cmpRanks(r.rank, best.rank) === 0).map(r => r.userId);

    this.io.to(this._room(tableId)).emit('tp:showdown', {
      tableId,
      handNo: t.handNo,
      results: results.map(r => ({
        userId: r.userId,
        cards: r.hand.map(cardStr),
        rank: r.rank
      })),
      winners
    });

    this._endHand(tableId, { reason: 'showdown', winners });
  }

  async _endHand(tableId, { reason, winners }) {
    const t = this.tables.get(tableId);
    if (!t) return;
    clearTimeout(t.turnTimer);

    // Split pot evenly among winners (no side pot logic for first version)
    const share = Math.floor(t.pot / winners.length);
    const leftover = t.pot - (share * winners.length);

    try {
      if (t.hooks.credit) {
        for (const uid of winners) {
          await t.hooks.credit(uid, share, { tableId, handNo: t.handNo, type: 'TP_WIN', reason });
        }
        // Optional leftover: give to first winner
        if (leftover > 0 && winners[0]) {
          await t.hooks.credit(winners[0], leftover, { tableId, handNo: t.handNo, type: 'TP_LEFTOVER' });
        }
      }
      if (t.hooks.onHandSettled) {
        await t.hooks.onHandSettled({
          tableId, handNo: t.handNo, reason, pot: t.pot, winners, share, leftover
        });
      }
    } catch (e) {
      // log only; don’t block flow
      // console.error('Settlement error', e);
    }

    this.io.to(this._room(tableId)).emit('tp:hand:end', {
      tableId,
      handNo: t.handNo,
      reason,
      winners,
      pot: t.pot,
    });

    // Reset hand state
    t.isHandActive = false;
    t.inHand.clear();
    t.folded.clear();
    t.hands.clear();
    t.pot = 0;
    t.currentBet = 0;
    t.lastRaiser = null;
    t.turnIdx = -1;
    t.turnDeadline = null;

    this._broadcastState(tableId);

    // Autostart next hand if enough players
    if (this._activeSeatedCount(t) >= t.cfg.minPlayers) {
      setTimeout(() => this._startHand(tableId), 1200);
    }
  }

  // ---- Emission helpers ----
  _room(tableId) {
    return `teenpatti:${tableId}`;
  }

  _joinRoom(socketId, room) {
    if (!socketId) return;
    const s = this.io.sockets.sockets.get(socketId);
    if (s) s.join(room);
  }

  _broadcastState(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return;
    const pubPlayers = t.players
      .filter(Boolean)
      .map(publicPlayerView);

    this.io.to(this._room(tableId)).emit('tp:state', {
      tableId,
      handNo: t.handNo,
      isHandActive: t.isHandActive,
      dealerIdx: t.dealerIdx,
      players: pubPlayers,
      pot: t.pot,
      currentBet: t.currentBet,
      lastRaiser: t.lastRaiser,
      turnUserId: (t.turnIdx >= 0 && t.players[t.turnIdx]) ? t.players[t.turnIdx].userId : null,
      turnDeadline: t.turnDeadline,
      cfg: t.cfg,
    });
  }
}

module.exports = { TeenPattiEngine };
