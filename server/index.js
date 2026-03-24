import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MAX_CRACKS = 12;
const MAX_HISTORY = 200;
const MAX_STORED = 3;
const DEFAULT_BALANCE = 1000;
const FORCE_BONUS = process.env.FORCE_BONUS === 'true';
const FORCE_WIN = process.env.FORCE_WIN === 'true';
const LOG_PATH = process.env.LOG_PATH || path.resolve('server', 'logs', 'transactions.jsonl');
const STATE_PATH = process.env.STATE_PATH || path.resolve('server', 'data', 'state.json');
const EGG_CONFIG = [
  { id: 'gold', label: 'Gold Egg', bet: 100 },
  { id: 'premium', label: 'Premium Egg', bet: 1000 },
];
const EGG_CONFIG_BY_ID = EGG_CONFIG.reduce((acc, egg) => {
  acc[egg.id] = egg;
  return acc;
}, {});

const userStates = new Map();

const serializeUserState = (userState) => ({
  balance: userState.balance,
  history: userState.history.map((entry) => ({
    ...entry,
    time: entry.time instanceof Date ? entry.time.toISOString() : entry.time,
  })),
  activeEggUid: userState.activeEggUid || null,
  nextEggSeq: userState.nextEggSeq || 0,
  eggs: Array.from(userState.eggs.values()).map((egg) => ({ ...egg })),
});

const hydrateUserState = (rawState = {}) => ({
  balance: typeof rawState.balance === 'number' ? rawState.balance : DEFAULT_BALANCE,
  history: Array.isArray(rawState.history)
    ? rawState.history.map((entry) => ({
      ...entry,
      time: entry?.time ? new Date(entry.time) : new Date(),
    }))
    : [],
  activeEggUid: typeof rawState.activeEggUid === 'string' ? rawState.activeEggUid : null,
  nextEggSeq: Number(rawState.nextEggSeq) || 0,
  eggs: new Map(
    Array.isArray(rawState.eggs)
      ? rawState.eggs
        .filter((egg) => egg?.uid)
        .map((egg) => [egg.uid, { ...egg }])
      : [],
  ),
});

const loadStateStore = async () => {
  try {
    const content = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(content);
    Object.entries(parsed || {}).forEach(([userId, rawState]) => {
      userStates.set(userId, hydrateUserState(rawState));
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to load state store:', error);
    }
  }
};

const persistStateStore = async () => {
  try {
    const snapshot = Object.fromEntries(
      Array.from(userStates.entries()).map(([userId, userState]) => [userId, serializeUserState(userState)]),
    );
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    await fs.writeFile(STATE_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist state store:', error);
  }
};

const buildStatus = (result) => {
  if (result === 'win') return 1;
  if (result === 'lose') return 0;
  if (result === 'redeemed') return 2;
  return null;
};

const buildLevel = (tryIndex) => {
  if (typeof tryIndex !== 'number' || Number.isNaN(tryIndex)) return 1;
  return Math.min(Math.max(tryIndex + 1, 1), MAX_CRACKS);
};

const getEggTemplate = (eggType = 'gold') => EGG_CONFIG_BY_ID[eggType] || EGG_CONFIG[0];

const getUserState = (userId = '') => {
  const key = userId || 'guest';
  if (!userStates.has(key)) {
    userStates.set(key, {
      balance: DEFAULT_BALANCE,
      eggs: new Map(),
      history: [],
      activeEggUid: null,
      nextEggSeq: 0,
    });
  }
  return userStates.get(key);
};

const makeEggUid = (userState, eggType = 'gold') => {
  userState.nextEggSeq += 1;
  return `${eggType}-${Date.now()}-${userState.nextEggSeq}`;
};

const createEggState = (userState, eggType = 'gold', eggId) => {
  const template = getEggTemplate(eggType);
  const uid = eggId || makeEggUid(userState, template.id);
  return {
    uid,
    id: template.id,
    label: template.label,
    bet: template.bet,
    tries: 0,
    hasCracked: false,
    lastWinAmount: 0,
    isMaxed: false,
    order: userState.nextEggSeq,
  };
};

const serializeEgg = (egg) => ({
  uid: egg.uid,
  id: egg.id,
  label: egg.label,
  bet: egg.bet,
  tries: egg.tries,
  hasCracked: egg.hasCracked,
  lastWinAmount: egg.lastWinAmount,
  isMaxed: egg.isMaxed,
});

const serializeState = (userState) => {
  const eggs = Array.from(userState.eggs.values())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(serializeEgg);
  return {
    activeEggUid: userState.activeEggUid || null,
    storedEggIds: eggs.map((egg) => egg.uid),
    eggs,
    history: userState.history.map((entry) => ({
      ...entry,
      time: entry.time instanceof Date ? entry.time.toISOString() : entry.time,
    })),
  };
};

const resolveBetAmount = (eggType, tryIndex, fallbackBetAmount = 0) => {
  const baseBet = EGG_CONFIG_BY_ID[eggType]?.bet;
  if (typeof baseBet !== 'number' || Number.isNaN(baseBet)) {
    return Math.max(0, Number(fallbackBetAmount) || 0);
  }
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, MAX_CRACKS));
  return baseBet * Math.pow(2, safeTryIndex);
};

const writeLog = async (entry) => {
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn('Failed to write log entry:', error);
  }
};

const recordHistory = (userState, status, egg, extra = {}) => {
  const entry = {
    status,
    eggId: egg?.uid ?? extra.eggId ?? null,
    eggType: egg?.id ?? extra.eggType ?? null,
    betAmount: typeof extra.betAmount === 'number' ? extra.betAmount : (egg?.bet ?? null),
    tryIndex: typeof extra.tryIndex === 'number' ? extra.tryIndex : (egg?.tries ?? 0),
    time: new Date(),
    ...extra,
  };
  userState.history.unshift(entry);
  if (userState.history.length > MAX_HISTORY) {
    userState.history.length = MAX_HISTORY;
  }
  return entry;
};

const buildResponse = (userState, payload = {}) => ({
  apiStatus: 'ok',
  balance: userState.balance,
  serverTime: new Date().toISOString(),
  state: serializeState(userState),
  ...payload,
});

const getExistingEgg = (userState, eggId) => {
  if (!eggId) return null;
  return userState.eggs.get(eggId) || null;
};

const markCurrentStoredIfNeeded = (userState, nextEggUid = null) => {
  const currentEgg = getExistingEgg(userState, userState.activeEggUid);
  if (currentEgg && currentEgg.uid !== nextEggUid) {
    recordHistory(userState, 1, currentEgg, {
      actionType: 'stored',
      betAmount: currentEgg.bet,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: currentEgg.tries ?? 0,
    });
  }
  return currentEgg;
};

app.post('/game/init', (req, res) => {
  const { userId = '', lang = 'en' } = req.body || {};
  const userState = getUserState(userId);

  res.json({
    apiStatus: 'ok',
    userId,
    lang,
    balance: userState.balance,
    config: {
      eggs: EGG_CONFIG,
      currency: 'RM',
      maxStored: MAX_STORED,
      maxCracks: MAX_CRACKS,
    },
    state: serializeState(userState),
    serverTime: new Date().toISOString(),
  });
});

app.post('/game/history', (req, res) => {
  const { userId = '' } = req.body || {};
  const userState = getUserState(userId);
  res.json({
    apiStatus: 'ok',
    balance: userState.balance,
    state: serializeState(userState),
    history: serializeState(userState).history,
    serverTime: new Date().toISOString(),
  });
});

app.post('/game/action', (req, res) => {
  const {
    userId = '',
    token = '',
    action = 'crack',
    betAmount = 0,
    eggId,
    eggType = 'gold',
    tryIndex = 0,
  } = req.body || {};
  const userState = getUserState(userId);
  const requestTryIndex = typeof tryIndex === 'number' ? tryIndex : 0;
  const balanceBefore = userState.balance;
  const now = new Date().toISOString();

  if (action === 'buy') {
    const purchaseCost = resolveBetAmount(eggType, 0, betAmount);
    if (userState.activeEggUid) {
      return res.status(409).json({ apiStatus: 'error', message: 'Active egg must be stored or finished before buying a new egg.' });
    }
    if (userState.eggs.size >= MAX_STORED) {
      return res.status(409).json({ apiStatus: 'error', message: `Storage is full (${MAX_STORED}/${MAX_STORED}).` });
    }
    if (userState.balance < purchaseCost) {
      return res.status(409).json({ apiStatus: 'error', message: 'Insufficient UCoins' });
    }
    markCurrentStoredIfNeeded(userState);
    const egg = createEggState(userState, eggType, eggId);
    egg.bet = purchaseCost;
    userState.eggs.set(egg.uid, egg);
    userState.activeEggUid = egg.uid;
    userState.balance -= purchaseCost;
    recordHistory(userState, 1, egg, {
      actionType: 'buy',
      betAmount: purchaseCost,
      chargeAmount: purchaseCost,
      winAmount: 0,
      tryIndex: 0,
    });
    const response = buildResponse(userState, {
      status: null,
      result: 'bought',
      eggId: egg.uid,
      eggType: egg.id,
      betAmount: purchaseCost,
      chargeAmount: purchaseCost,
      winAmount: 0,
      tryIndex: 0,
      level: 1,
      bonus: false,
    });
    void writeLog({
      time: now,
      userId,
      token,
      action,
      eggId: egg.uid,
      eggType: egg.id,
      requestTryIndex,
      serverTryIndex: 0,
      betAmount,
      effectiveBetAmount: purchaseCost,
      result: response.result,
      status: response.status,
      winAmount: 0,
      chargeAmount: purchaseCost,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: false,
    });
    void persistStateStore();
    return res.json(response);
  }

  const egg = getExistingEgg(userState, eggId) || (userState.activeEggUid ? getExistingEgg(userState, userState.activeEggUid) : null);
  if (!egg && action !== 'buy') {
    return res.status(404).json({ apiStatus: 'error', message: 'Egg not found.' });
  }

  const effectiveEggType = egg?.id || eggType || 'gold';
  const serverTryIndex = egg?.tries ?? 0;
  const effectiveBetAmount = resolveBetAmount(effectiveEggType, serverTryIndex, betAmount || egg?.bet || 0);
  const level = buildLevel(serverTryIndex);

  if (action === 'store') {
    if (egg && userState.activeEggUid === egg.uid) {
      userState.activeEggUid = null;
    }
    recordHistory(userState, 1, egg, {
      actionType: 'stored',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: egg?.tries ?? 0,
    });
    const response = buildResponse(userState, {
      status: null,
      result: 'stored',
      winAmount: 0,
      chargeAmount: 0,
      eggId: egg?.uid ?? eggId,
      eggType: effectiveEggType,
      tryIndex: egg?.tries ?? 0,
      level,
      bonus: false,
    });
    void writeLog({
      time: now,
      userId,
      token,
      action,
      eggId: egg?.uid ?? eggId,
      eggType: effectiveEggType,
      requestTryIndex,
      serverTryIndex,
      level,
      betAmount,
      effectiveBetAmount,
      result: response.result,
      status: response.status,
      winAmount: 0,
      chargeAmount: 0,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: false,
    });
    void persistStateStore();
    return res.json(response);
  }

  if (action === 'retrieve') {
    markCurrentStoredIfNeeded(userState, egg.uid);
    userState.activeEggUid = egg.uid;
    recordHistory(userState, 1, egg, {
      actionType: 'retrieve',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: egg?.tries ?? 0,
    });
    const response = buildResponse(userState, {
      status: null,
      result: 'retrieved',
      winAmount: 0,
      chargeAmount: 0,
      eggId: egg.uid,
      eggType: effectiveEggType,
      tryIndex: egg.tries ?? 0,
      level,
      bonus: false,
    });
    void writeLog({
      time: now,
      userId,
      token,
      action,
      eggId: egg.uid,
      eggType: effectiveEggType,
      requestTryIndex,
      serverTryIndex,
      level,
      betAmount,
      effectiveBetAmount,
      result: response.result,
      status: response.status,
      winAmount: 0,
      chargeAmount: 0,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: false,
    });
    void persistStateStore();
    return res.json(response);
  }

  // Redeem is handled by backoffice after support confirms the player's screenshot.
  if (action === 'redeem') {
    const winAmount = effectiveBetAmount;
    userState.balance = Math.max(0, userState.balance + winAmount);
    if (egg) {
      userState.eggs.delete(egg.uid);
      if (userState.activeEggUid === egg.uid) {
        userState.activeEggUid = null;
      }
    }
    recordHistory(userState, 2, egg, {
      actionType: 'redeemed',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount,
      tryIndex: egg?.tries ?? 0,
    });
    const response = buildResponse(userState, {
      status: 2,
      result: 'redeemed',
      winAmount,
      chargeAmount: 0,
      eggId: egg?.uid ?? eggId,
      eggType: effectiveEggType,
      tryIndex: 0,
      level: 1,
      bonus: false,
    });
    void writeLog({
      time: now,
      userId,
      token,
      action,
      eggId: egg?.uid ?? eggId,
      eggType: effectiveEggType,
      requestTryIndex,
      serverTryIndex,
      level: response.level,
      betAmount,
      effectiveBetAmount,
      result: 'redeemed',
      status: response.status,
      winAmount,
      chargeAmount: 0,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: false,
    });
    void persistStateStore();
    return res.json(response);
  }

  userState.activeEggUid = egg.uid;
  const baseWinChance = 0.5 / Math.pow(2, Math.max(0, serverTryIndex));
  const bonusChance = 0.01;
  const didBonus = FORCE_BONUS ? true : Math.random() < bonusChance;
  const didWin = FORCE_WIN ? true : Math.random() < baseWinChance;
  const winAmount = didWin ? effectiveBetAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = egg?.hasCracked ? effectiveBetAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, MAX_CRACKS) : 0;
  if (didWin) {
    egg.hasCracked = true;
    egg.tries = nextTryIndex;
    egg.lastWinAmount = winAmount;
    egg.bet = resolveBetAmount(egg.id, nextTryIndex, effectiveBetAmount * 2);
    egg.isMaxed = nextTryIndex >= MAX_CRACKS;
  } else {
    userState.eggs.delete(egg.uid);
    if (userState.activeEggUid === egg.uid) {
      userState.activeEggUid = null;
    }
  }
  recordHistory(userState, buildStatus(result), egg, {
    actionType: result,
    betAmount: effectiveBetAmount,
    chargeAmount,
    winAmount,
    tryIndex: didWin ? nextTryIndex : serverTryIndex + 1,
  });
  const response = buildResponse(userState, {
    status: buildStatus(result),
    result,
    winAmount,
    chargeAmount,
    eggId: egg.uid,
    eggType: effectiveEggType,
    tryIndex: nextTryIndex,
    level: buildLevel(nextTryIndex),
    bonus: didBonus,
  });
  void writeLog({
    time: now,
    userId,
    token,
    action,
    eggId: egg.uid,
    eggType: effectiveEggType,
    requestTryIndex,
    serverTryIndex,
    level: response.level,
    betAmount,
    effectiveBetAmount,
    chargeAmount,
    result: response.result,
    status: response.status,
    winAmount: response.winAmount,
    balanceBefore,
    balanceAfter: userState.balance,
    bonus: response.bonus,
  });
  void persistStateStore();
  return res.json(response);
});

await loadStateStore();

app.listen(PORT, () => {
  console.log(`Golden Eggs microservice listening on http://localhost:${PORT}`);
});
