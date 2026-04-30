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
const DEFAULT_LEGACY_MAX_LEVELS = 12;
const DEFAULT_MAX_STORED = 3;
const DEFAULT_CURRENCY = 'RM';
const LOG_PATH = process.env.LOG_PATH || path.resolve('server', 'logs', 'transactions.jsonl');
const STATE_PATH = process.env.STATE_PATH || path.resolve('server', 'data', 'state.json');
const GAME_CONFIG_PATH = process.env.GAME_CONFIG_PATH || path.resolve('server', 'data', 'game-config.json');
const DEFAULT_EGG_CONFIG = [
  { id: 'gold', name: 'Gold Egg', label: 'Gold Egg', bet: 100, levels: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400, 204800] },
  { id: 'premium', name: 'Premium Egg', label: 'Premium Egg', bet: 1000, levels: [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 1024000, 2048000] },
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

const normalizePositiveInteger = (value, fieldName, { min = 1, max = null } = {}) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return { ok: false, message: `${fieldName} must be a whole number.` };
  }
  if (numeric < min) {
    return { ok: false, message: `${fieldName} must be at least ${min}.` };
  }
  if (max !== null && numeric > max) {
    return { ok: false, message: `${fieldName} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: numeric };
};

const normalizeOptionalUrl = (value, fieldName) => {
  if (typeof value === 'undefined' || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: `${fieldName} must be a non-empty URL string.` };
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, message: `${fieldName} must use http or https.` };
    }
  } catch {
    return { ok: false, message: `${fieldName} must be a valid absolute URL.` };
  }
  return { ok: true, value: trimmed };
};

const normalizeLevelConfig = (rawLevel, index, eggId) => {
  if (typeof rawLevel === 'number' || typeof rawLevel === 'string') {
    const amount = Number(rawLevel);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: `Egg ${eggId} level ${index + 1} cost must be greater than 0.` };
    }
    return { ok: true, value: Number(amount.toFixed(2)) };
  }

  if (!rawLevel || typeof rawLevel !== 'object') {
    return { ok: false, message: `Egg ${eggId} level ${index + 1} must be an amount or level config object.` };
  }

  const cost = Number(rawLevel.cost ?? rawLevel.amount ?? rawLevel.price ?? rawLevel.bet);
  if (!Number.isFinite(cost) || cost <= 0) {
    return { ok: false, message: `Egg ${eggId} level ${index + 1} cost must be greater than 0.` };
  }
  const rawPrize = rawLevel.prize ?? rawLevel.winAmount ?? rawLevel.reward ?? cost;
  const prize = Number(rawPrize);
  if (!Number.isFinite(prize) || prize <= 0) {
    return { ok: false, message: `Egg ${eggId} level ${index + 1} prize must be greater than 0.` };
  }

  const fullImage = normalizeOptionalUrl(
    rawLevel.fullImageUrl ?? rawLevel.eggImageUrl ?? rawLevel.imageUrl,
    `Egg ${eggId} level ${index + 1} fullImageUrl`,
  );
  if (!fullImage.ok) return fullImage;
  const crackImage = normalizeOptionalUrl(
    rawLevel.crackImageUrl ?? rawLevel.brokenImageUrl ?? rawLevel.crackedImageUrl,
    `Egg ${eggId} level ${index + 1} crackImageUrl`,
  );
  if (!crackImage.ok) return crackImage;
  const winRate = typeof rawLevel.winRate === 'undefined' ? null : normalizeRate(rawLevel.winRate);
  if (winRate && !winRate.ok) {
    return { ok: false, message: `Egg ${eggId} level ${index + 1} winRate invalid: ${winRate.message}` };
  }
  const bonusRate = typeof rawLevel.bonusRate === 'undefined' ? null : normalizeRate(rawLevel.bonusRate);
  if (bonusRate && !bonusRate.ok) {
    return { ok: false, message: `Egg ${eggId} level ${index + 1} bonusRate invalid: ${bonusRate.message}` };
  }

  const name = typeof rawLevel.name === 'string' && rawLevel.name.trim() ? rawLevel.name.trim() : undefined;
  const label = typeof rawLevel.label === 'string' && rawLevel.label.trim()
    ? rawLevel.label.trim()
    : name;

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(label ? { label } : {}),
      cost: Number(cost.toFixed(2)),
      prize: Number(prize.toFixed(2)),
      ...(winRate ? { winRate: winRate.value } : {}),
      ...(bonusRate ? { bonusRate: bonusRate.value } : {}),
      ...(fullImage.value ? { fullImageUrl: fullImage.value } : {}),
      ...(crackImage.value ? { crackImageUrl: crackImage.value } : {}),
    },
  };
};

const getLevelAmount = (level, field = 'cost') => {
  if (typeof level === 'number') return level;
  if (level && typeof level === 'object') {
    const amount = Number(level[field] ?? level.cost ?? level.amount ?? level.price ?? level.bet);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
};

const normalizeEggConfig = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: 'eggs must be a non-empty array.' };
  }

  const seenIds = new Set();
  const eggs = [];
  for (const rawEgg of value) {
    const id = typeof rawEgg?.id === 'string' ? rawEgg.id.trim() : '';
    const name = typeof rawEgg?.name === 'string' ? rawEgg.name.trim() : '';
    const label = typeof rawEgg?.label === 'string' ? rawEgg.label.trim() : '';
    const rawLevels = Array.isArray(rawEgg?.levels) ? rawEgg.levels : null;
    const backgroundImage = normalizeOptionalUrl(rawEgg?.backgroundImageUrl, `Egg ${id || 'unknown'} backgroundImageUrl`);
    if (!backgroundImage.ok) return backgroundImage;
    const tabImage = normalizeOptionalUrl(rawEgg?.tabImageUrl, `Egg ${id || 'unknown'} tabImageUrl`);
    if (!tabImage.ok) return tabImage;
    const tabActiveImage = normalizeOptionalUrl(rawEgg?.tabActiveImageUrl, `Egg ${id || 'unknown'} tabActiveImageUrl`);
    if (!tabActiveImage.ok) return tabActiveImage;
    const buttonImage = normalizeOptionalUrl(rawEgg?.buttonImageUrl, `Egg ${id || 'unknown'} buttonImageUrl`);
    if (!buttonImage.ok) return buttonImage;
    const labelImage = normalizeOptionalUrl(rawEgg?.labelImageUrl, `Egg ${id || 'unknown'} labelImageUrl`);
    if (!labelImage.ok) return labelImage;
    const normalizedLevels = [];
    if (rawLevels) {
      if (rawLevels.length === 0) {
        return { ok: false, message: `Egg ${id} levels must contain at least 1 amount.` };
      }
      for (let index = 0; index < rawLevels.length; index += 1) {
        const normalizedLevel = normalizeLevelConfig(rawLevels[index], index, id || 'unknown');
        if (!normalizedLevel.ok) return normalizedLevel;
        normalizedLevels.push(normalizedLevel.value);
      }
    }
    const firstLevelCost = normalizedLevels.length ? getLevelAmount(normalizedLevels[0], 'cost') : 0;
    const bet = Number(rawEgg?.bet ?? firstLevelCost);
    if (!id) {
      return { ok: false, message: 'Every egg needs a non-empty id.' };
    }
    if (seenIds.has(id)) {
      return { ok: false, message: `Duplicate egg id: ${id}.` };
    }
    if (!Number.isFinite(bet) || bet <= 0) {
      return { ok: false, message: `Egg ${id} bet or first level amount must be greater than 0.` };
    }
    seenIds.add(id);
    eggs.push({
      id,
      name: name || label || id,
      label: label || name || id,
      bet: normalizedLevels.length ? firstLevelCost : Number(bet.toFixed(2)),
      ...(backgroundImage.value ? { backgroundImageUrl: backgroundImage.value } : {}),
      ...(tabImage.value ? { tabImageUrl: tabImage.value } : {}),
      ...(tabActiveImage.value ? { tabActiveImageUrl: tabActiveImage.value } : {}),
      ...(buttonImage.value ? { buttonImageUrl: buttonImage.value } : {}),
      ...(labelImage.value ? { labelImageUrl: labelImage.value } : {}),
      ...(normalizedLevels.length ? { levels: normalizedLevels } : {}),
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
  const nextInfo = normalizeInfoConfig(raw?.info);
  gameConfig.winRate = nextWinRate.ok ? nextWinRate.value : DEFAULT_WIN_RATE;
  gameConfig.bonusRate = nextBonusRate.ok ? nextBonusRate.value : DEFAULT_BONUS_RATE;
  gameConfig.eggs = nextEggs.ok ? nextEggs.value : DEFAULT_EGG_CONFIG.map((egg) => ({ ...egg }));
  gameConfig.currency = typeof raw?.currency === 'string' && raw.currency.trim()
    ? raw.currency.trim()
    : DEFAULT_CURRENCY;
  gameConfig.maxStored = nextMaxStored.ok ? nextMaxStored.value : DEFAULT_MAX_STORED;
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

const getEggMaxLevel = (eggOrType) => {
  if (eggOrType && typeof eggOrType === 'object' && Array.isArray(eggOrType.levels) && eggOrType.levels.length > 0) {
    return eggOrType.levels.length;
  }
  const eggType = typeof eggOrType === 'string' ? eggOrType : eggOrType?.id;
  const eggConfig = eggType ? getEggConfigById()[eggType] : null;
  if (Array.isArray(eggConfig?.levels) && eggConfig.levels.length > 0) {
    return eggConfig.levels.length;
  }
  return DEFAULT_LEGACY_MAX_LEVELS;
};

const buildLevel = (eggOrType, tryIndex) => {
  if (typeof tryIndex !== 'number' || Number.isNaN(tryIndex)) return 1;
  return Math.min(Math.max(tryIndex + 1, 1), getEggMaxLevel(eggOrType));
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
    name: template.name,
    label: template.label,
    bet: resolveBetAmount(template.id, 0, template.bet),
    levels: Array.isArray(template.levels) ? [...template.levels] : undefined,
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
  name: egg.name,
  label: egg.label,
  bet: egg.bet,
  ...(Array.isArray(egg.levels) ? { levels: [...egg.levels] } : {}),
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
  const eggConfig = getEggConfigById()[eggType];
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, getEggMaxLevel(eggType)));
  if (Array.isArray(eggConfig?.levels) && eggConfig.levels.length > 0) {
    const configuredLevel = eggConfig.levels[Math.min(safeTryIndex, eggConfig.levels.length - 1)];
    return getLevelAmount(configuredLevel, 'cost');
  }
  const baseBet = eggConfig?.bet;
  if (typeof baseBet !== 'number' || Number.isNaN(baseBet)) {
    return Math.max(0, Number(fallbackBetAmount) || 0);
  }
  return baseBet * Math.pow(2, safeTryIndex);
};

const resolvePrizeAmount = (eggType, tryIndex, fallbackPrizeAmount = 0) => {
  const eggConfig = getEggConfigById()[eggType];
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, getEggMaxLevel(eggType)));
  if (Array.isArray(eggConfig?.levels) && eggConfig.levels.length > 0) {
    const configuredLevel = eggConfig.levels[Math.min(safeTryIndex, eggConfig.levels.length - 1)];
    const prize = getLevelAmount(configuredLevel, 'prize');
    return prize || getLevelAmount(configuredLevel, 'cost');
  }
  return Math.max(0, Number(fallbackPrizeAmount) || 0);
};

const resolveLevelRate = (eggType, tryIndex, field, fallbackRate) => {
  const eggConfig = getEggConfigById()[eggType];
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, getEggMaxLevel(eggType)));
  if (Array.isArray(eggConfig?.levels) && eggConfig.levels.length > 0) {
    const configuredLevel = eggConfig.levels[Math.min(safeTryIndex, eggConfig.levels.length - 1)];
    if (configuredLevel && typeof configuredLevel === 'object' && typeof configuredLevel[field] === 'number') {
      return configuredLevel[field];
    }
  }
  return fallbackRate;
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
      info: {
        title: gameConfig.info.title,
        steps: [...gameConfig.info.steps],
      },
      rates: {
        winRate: gameConfig.winRate,
        bonusRate: gameConfig.bonusRate,
      },
      forceWin: FORCE_WIN,
      forceBonus: FORCE_BONUS,
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
  const maxLevel = getEggMaxLevel(egg || effectiveEggType);
  const level = buildLevel(egg || effectiveEggType, serverTryIndex);

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
    const winAmount = resolvePrizeAmount(effectiveEggType, serverTryIndex, effectiveBetAmount);
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
  const winRate = resolveLevelRate(effectiveEggType, serverTryIndex, 'winRate', gameConfig.winRate);
  const bonusRate = resolveLevelRate(effectiveEggType, serverTryIndex, 'bonusRate', gameConfig.bonusRate);
  const didBonus = FORCE_BONUS ? true : Math.random() < bonusRate;
  const didWin = FORCE_WIN ? true : Math.random() < winRate;
  const prizeAmount = resolvePrizeAmount(effectiveEggType, serverTryIndex, effectiveBetAmount);
  const winAmount = didWin ? prizeAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = egg?.hasCracked ? effectiveBetAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, maxLevel) : 0;
  if (didWin) {
    egg.hasCracked = true;
    egg.tries = nextTryIndex;
    egg.lastWinAmount = winAmount;
    egg.bet = resolveBetAmount(egg.id, nextTryIndex, effectiveBetAmount * 2);
    egg.isMaxed = nextTryIndex >= maxLevel;
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
    level: buildLevel(egg || effectiveEggType, nextTryIndex),
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
