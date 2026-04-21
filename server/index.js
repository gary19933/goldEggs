import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MAX_HISTORY = 200;
const DEFAULT_BALANCE = 1000;
const FORCE_BONUS = process.env.FORCE_BONUS === 'true';
const FORCE_WIN = process.env.FORCE_WIN === 'true';
const ADMIN_API_KEY = (process.env.ADMIN_API_KEY || '').trim();
const DEFAULT_WIN_RATE = 0.5;
const DEFAULT_BONUS_RATE = 0.01;
const DEFAULT_MAX_CRACKS = 12;
const DEFAULT_MAX_STORED = 3;
const DEFAULT_CURRENCY = 'RM';
const LOG_PATH = process.env.LOG_PATH || path.resolve('server', 'logs', 'transactions.jsonl');
const STATE_PATH = process.env.STATE_PATH || path.resolve('server', 'data', 'state.json');
const GAME_CONFIG_PATH = process.env.GAME_CONFIG_PATH || path.resolve('server', 'data', 'game-config.json');
const DEFAULT_EGG_CONFIG = [
  { id: 'gold', label: 'Gold Egg', bet: 100 },
  { id: 'premium', label: 'Premium Egg', bet: 1000 },
];
const DEFAULT_INFO = {
  title: 'How To Play',
  steps: [
    'On the game page, choose the egg you want to buy from the tabs.',
    'Use the required UCoins to buy the selected egg. The purchase price covers your first crack attempt.',
    'After buying, crack the egg to try your luck.',
    'A bonus round can appear before a crack. If that crack succeeds, the reward is doubled.',
    'If the crack is successful, the egg moves to the next level.',
    'After a successful crack, the next crack will deduct the UCoins required for that level.',
    'If the crack fails, you need to buy a new egg to start again.',
    'To redeem an egg, take a screenshot and send it to customer support for verification.',
    'After customer support processes the request, the redeemed record will appear in History automatically.',
  ],
};

const userStates = new Map();
const gameConfig = {
  winRate: DEFAULT_WIN_RATE,
  bonusRate: DEFAULT_BONUS_RATE,
  eggs: DEFAULT_EGG_CONFIG.map((egg) => ({ ...egg })),
  currency: DEFAULT_CURRENCY,
  maxStored: DEFAULT_MAX_STORED,
  maxCracks: DEFAULT_MAX_CRACKS,
  info: {
    title: DEFAULT_INFO.title,
    steps: [...DEFAULT_INFO.steps],
  },
  updatedAt: null,
  updatedBy: 'system',
};

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

const normalizeRate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, message: 'Rate must be a finite number.' };
  }
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (normalized < 0 || normalized > 1) {
    return { ok: false, message: 'Rate must be between 0 and 1 (or 0 to 100 as a percentage).' };
  }
  return { ok: true, value: Number(normalized.toFixed(6)) };
};

const normalizePositiveInteger = (value, fieldName, { min = 1, max = 100 } = {}) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return { ok: false, message: `${fieldName} must be a whole number.` };
  }
  if (numeric < min || numeric > max) {
    return { ok: false, message: `${fieldName} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: numeric };
};

const normalizeEggConfig = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: 'eggs must be a non-empty array.' };
  }

  const seenIds = new Set();
  const eggs = [];
  for (const rawEgg of value) {
    const id = typeof rawEgg?.id === 'string' ? rawEgg.id.trim() : '';
    const label = typeof rawEgg?.label === 'string' ? rawEgg.label.trim() : '';
    const bet = Number(rawEgg?.bet);
    if (!id) {
      return { ok: false, message: 'Every egg needs a non-empty id.' };
    }
    if (seenIds.has(id)) {
      return { ok: false, message: `Duplicate egg id: ${id}.` };
    }
    if (!Number.isFinite(bet) || bet <= 0) {
      return { ok: false, message: `Egg ${id} bet must be greater than 0.` };
    }
    seenIds.add(id);
    eggs.push({
      id,
      label: label || id,
      bet: Number(bet.toFixed(2)),
    });
  }

  return { ok: true, value: eggs };
};

const normalizeInfoConfig = (value) => {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'info must be an object.' };
  }
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : DEFAULT_INFO.title;
  if (!Array.isArray(value.steps)) {
    return { ok: false, message: 'info.steps must be an array of text strings.' };
  }
  const steps = value.steps
    .map((step) => (typeof step === 'string' ? step.trim() : ''))
    .filter(Boolean);
  if (steps.length === 0) {
    return { ok: false, message: 'info.steps must contain at least one text string.' };
  }
  return { ok: true, value: { title, steps } };
};

const serializeGameConfig = () => ({
  winRate: gameConfig.winRate,
  bonusRate: gameConfig.bonusRate,
  eggs: gameConfig.eggs.map((egg) => ({ ...egg })),
  currency: gameConfig.currency,
  maxStored: gameConfig.maxStored,
  maxCracks: gameConfig.maxCracks,
  info: {
    title: gameConfig.info.title,
    steps: [...gameConfig.info.steps],
  },
  updatedAt: gameConfig.updatedAt,
  updatedBy: gameConfig.updatedBy,
  forceWin: FORCE_WIN,
  forceBonus: FORCE_BONUS,
});

const hydrateGameConfig = (raw = {}) => {
  const nextWinRate = normalizeRate(raw?.winRate);
  const nextBonusRate = normalizeRate(raw?.bonusRate);
  const nextEggs = normalizeEggConfig(raw?.eggs);
  const nextMaxStored = normalizePositiveInteger(raw?.maxStored, 'maxStored', { min: 1, max: 12 });
  const nextMaxCracks = normalizePositiveInteger(raw?.maxCracks, 'maxCracks', { min: 1, max: DEFAULT_MAX_CRACKS });
  const nextInfo = normalizeInfoConfig(raw?.info);
  gameConfig.winRate = nextWinRate.ok ? nextWinRate.value : DEFAULT_WIN_RATE;
  gameConfig.bonusRate = nextBonusRate.ok ? nextBonusRate.value : DEFAULT_BONUS_RATE;
  gameConfig.eggs = nextEggs.ok ? nextEggs.value : DEFAULT_EGG_CONFIG.map((egg) => ({ ...egg }));
  gameConfig.currency = typeof raw?.currency === 'string' && raw.currency.trim()
    ? raw.currency.trim()
    : DEFAULT_CURRENCY;
  gameConfig.maxStored = nextMaxStored.ok ? nextMaxStored.value : DEFAULT_MAX_STORED;
  gameConfig.maxCracks = nextMaxCracks.ok ? nextMaxCracks.value : DEFAULT_MAX_CRACKS;
  gameConfig.info = nextInfo.ok
    ? nextInfo.value
    : { title: DEFAULT_INFO.title, steps: [...DEFAULT_INFO.steps] };
  gameConfig.updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : null;
  gameConfig.updatedBy = typeof raw?.updatedBy === 'string' && raw.updatedBy.trim()
    ? raw.updatedBy.trim()
    : 'system';
};

const loadGameConfig = async () => {
  try {
    const content = await fs.readFile(GAME_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content);
    hydrateGameConfig(parsed || {});
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to load game config:', error);
    }
  }
};

const persistGameConfig = async () => {
  try {
    await fs.mkdir(path.dirname(GAME_CONFIG_PATH), { recursive: true });
    await fs.writeFile(GAME_CONFIG_PATH, JSON.stringify(serializeGameConfig(), null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist game config:', error);
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
  return Math.min(Math.max(tryIndex + 1, 1), gameConfig.maxCracks);
};

const getEggConfigById = () => gameConfig.eggs.reduce((acc, egg) => {
  acc[egg.id] = egg;
  return acc;
}, {});

const getEggTemplate = (eggType = 'gold') => getEggConfigById()[eggType] || gameConfig.eggs[0];

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
  const baseBet = getEggConfigById()[eggType]?.bet;
  if (typeof baseBet !== 'number' || Number.isNaN(baseBet)) {
    return Math.max(0, Number(fallbackBetAmount) || 0);
  }
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, gameConfig.maxCracks));
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
  rates: {
    winRate: gameConfig.winRate,
    bonusRate: gameConfig.bonusRate,
  },
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

const requireAdminAuth = (req, res, next) => {
  if (!ADMIN_API_KEY) {
    return next();
  }
  const requestKey = (req.get('x-admin-key') || '').trim();
  if (requestKey !== ADMIN_API_KEY) {
    return res.status(401).json({ apiStatus: 'error', message: 'Unauthorized admin request.' });
  }
  return next();
};

app.get('/admin/game-config', requireAdminAuth, (req, res) => {
  res.json({
    apiStatus: 'ok',
    config: serializeGameConfig(),
    serverTime: new Date().toISOString(),
  });
});

app.put('/admin/game-config', requireAdminAuth, async (req, res) => {
  const {
    winRate,
    bonusRate,
    eggs,
    currency,
    maxStored,
    maxCracks,
    info,
    infoTitle,
    infoSteps,
    updatedBy = 'admin',
  } = req.body || {};

  const hasUpdates = [
    winRate,
    bonusRate,
    eggs,
    currency,
    maxStored,
    maxCracks,
    info,
    infoTitle,
    infoSteps,
  ].some((value) => typeof value !== 'undefined');

  if (!hasUpdates) {
    return res.status(400).json({
      apiStatus: 'error',
      message: 'At least one game config field must be provided.',
    });
  }

  if (typeof winRate !== 'undefined') {
    const normalizedWinRate = normalizeRate(winRate);
    if (!normalizedWinRate.ok) {
      return res.status(400).json({ apiStatus: 'error', message: `winRate invalid: ${normalizedWinRate.message}` });
    }
    gameConfig.winRate = normalizedWinRate.value;
  }

  if (typeof bonusRate !== 'undefined') {
    const normalizedBonusRate = normalizeRate(bonusRate);
    if (!normalizedBonusRate.ok) {
      return res.status(400).json({ apiStatus: 'error', message: `bonusRate invalid: ${normalizedBonusRate.message}` });
    }
    gameConfig.bonusRate = normalizedBonusRate.value;
  }

  if (typeof eggs !== 'undefined') {
    const normalizedEggs = normalizeEggConfig(eggs);
    if (!normalizedEggs.ok) {
      return res.status(400).json({ apiStatus: 'error', message: `eggs invalid: ${normalizedEggs.message}` });
    }
    gameConfig.eggs = normalizedEggs.value;
  }

  if (typeof currency !== 'undefined') {
    if (typeof currency !== 'string' || !currency.trim()) {
      return res.status(400).json({ apiStatus: 'error', message: 'currency must be a non-empty string.' });
    }
    gameConfig.currency = currency.trim();
  }

  if (typeof maxStored !== 'undefined') {
    const normalizedMaxStored = normalizePositiveInteger(maxStored, 'maxStored', { min: 1, max: 12 });
    if (!normalizedMaxStored.ok) {
      return res.status(400).json({ apiStatus: 'error', message: normalizedMaxStored.message });
    }
    gameConfig.maxStored = normalizedMaxStored.value;
  }

  if (typeof maxCracks !== 'undefined') {
    const normalizedMaxCracks = normalizePositiveInteger(maxCracks, 'maxCracks', { min: 1, max: DEFAULT_MAX_CRACKS });
    if (!normalizedMaxCracks.ok) {
      return res.status(400).json({ apiStatus: 'error', message: normalizedMaxCracks.message });
    }
    gameConfig.maxCracks = normalizedMaxCracks.value;
  }

  if (typeof info !== 'undefined') {
    const normalizedInfo = normalizeInfoConfig(info);
    if (!normalizedInfo.ok) {
      return res.status(400).json({ apiStatus: 'error', message: `info invalid: ${normalizedInfo.message}` });
    }
    gameConfig.info = normalizedInfo.value;
  } else if (typeof infoTitle !== 'undefined' || typeof infoSteps !== 'undefined') {
    const nextInfo = {
      title: typeof infoTitle === 'undefined' ? gameConfig.info.title : infoTitle,
      steps: typeof infoSteps === 'undefined' ? gameConfig.info.steps : infoSteps,
    };
    const normalizedInfo = normalizeInfoConfig(nextInfo);
    if (!normalizedInfo.ok) {
      return res.status(400).json({ apiStatus: 'error', message: `info invalid: ${normalizedInfo.message}` });
    }
    gameConfig.info = normalizedInfo.value;
  }

  gameConfig.updatedAt = new Date().toISOString();
  gameConfig.updatedBy = typeof updatedBy === 'string' && updatedBy.trim() ? updatedBy.trim() : 'admin';
  await persistGameConfig();

  return res.json({
    apiStatus: 'ok',
    message: 'Game config updated. Applied globally to all players.',
    config: serializeGameConfig(),
    serverTime: new Date().toISOString(),
  });
});

app.post('/game/init', (req, res) => {
  const { userId = '', lang = 'en' } = req.body || {};
  const userState = getUserState(userId);

  res.json({
    apiStatus: 'ok',
    userId,
    lang,
    balance: userState.balance,
    config: {
      eggs: gameConfig.eggs.map((egg) => ({ ...egg })),
      currency: gameConfig.currency,
      maxStored: gameConfig.maxStored,
      maxCracks: gameConfig.maxCracks,
      info: {
        title: gameConfig.info.title,
        steps: [...gameConfig.info.steps],
      },
      rates: {
        winRate: gameConfig.winRate,
        bonusRate: gameConfig.bonusRate,
      },
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
    if (userState.eggs.size >= gameConfig.maxStored) {
      return res.status(409).json({ apiStatus: 'error', message: `Storage is full (${gameConfig.maxStored}/${gameConfig.maxStored}).` });
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
  const winRate = gameConfig.winRate;
  const bonusRate = gameConfig.bonusRate;
  const didBonus = FORCE_BONUS ? true : Math.random() < bonusRate;
  const didWin = FORCE_WIN ? true : Math.random() < winRate;
  const winAmount = didWin ? effectiveBetAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = egg?.hasCracked ? effectiveBetAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, gameConfig.maxCracks) : 0;
  if (didWin) {
    egg.hasCracked = true;
    egg.tries = nextTryIndex;
    egg.lastWinAmount = winAmount;
    egg.bet = resolveBetAmount(egg.id, nextTryIndex, effectiveBetAmount * 2);
    egg.isMaxed = nextTryIndex >= gameConfig.maxCracks;
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
    winRate,
    bonusRate,
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

await Promise.all([loadStateStore(), loadGameConfig()]);

app.listen(PORT, () => {
  console.log(`Golden Eggs microservice listening on http://localhost:${PORT}`);
});
