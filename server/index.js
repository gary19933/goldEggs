import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MAX_CRACKS = 12;
const DEFAULT_BALANCE = 1000;
const FORCE_BONUS = process.env.FORCE_BONUS === 'true';
const FORCE_WIN = process.env.FORCE_WIN === 'true';
const LOG_PATH = process.env.LOG_PATH || path.resolve('server', 'logs', 'transactions.jsonl');
const EGG_CONFIG = [
  { id: 'gold', label: 'Gold Egg', bet: 100 },
  { id: 'premium', label: 'Premium Egg', bet: 1000 },
];
const EGG_CONFIG_BY_ID = EGG_CONFIG.reduce((acc, egg) => {
  acc[egg.id] = egg;
  return acc;
}, {});

const userStates = new Map();

const buildStatus = (result) => {
  if (result === 'win') return 1;
  if (result === 'lose') return 0;
  if (result === 'cashout' || result === 'redeemed') return 2;
  return null;
};

const buildLevel = (tryIndex) => {
  if (typeof tryIndex !== 'number' || Number.isNaN(tryIndex)) return 1;
  return Math.min(Math.max(tryIndex + 1, 1), MAX_CRACKS);
};

const getUserState = (userId = '') => {
  const key = userId || 'guest';
  if (!userStates.has(key)) {
    userStates.set(key, { balance: DEFAULT_BALANCE, eggs: new Map() });
  }
  return userStates.get(key);
};

const getEggState = (userState, eggId, eggType = 'gold') => {
  if (!eggId) return null;
  if (!userState.eggs.has(eggId)) {
    userState.eggs.set(eggId, { hasCracked: false, tries: 0, eggType });
  }
  return userState.eggs.get(eggId);
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
      maxStored: 3,
      maxCracks: MAX_CRACKS,
    },
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
  const state = getEggState(userState, eggId, eggType) || {
    hasCracked: false,
    tries: 0,
    eggType,
  };
  const serverTryIndex = state?.tries ?? 0;
  const effectiveEggType = state?.eggType || eggType || 'gold';
  const effectiveBetAmount = resolveBetAmount(effectiveEggType, serverTryIndex, betAmount);
  const balanceBefore = userState.balance;
  const level = buildLevel(serverTryIndex);
  const now = new Date().toISOString();

  if (action === 'store') {
    const response = {
      apiStatus: 'ok',
      status: null,
      result: 'stored',
      winAmount: 0,
      chargeAmount: 0,
      balance: userState.balance,
      eggId,
      eggType: effectiveEggType,
      tryIndex: serverTryIndex,
      level,
      bonus: false,
      serverTime: now,
    };
    writeLog({
      time: now,
      userId,
      token,
      action,
      eggId,
      eggType: effectiveEggType,
      requestTryIndex,
      serverTryIndex,
      level,
      betAmount,
      effectiveBetAmount,
      result: response.result,
      status: response.status,
      winAmount: response.winAmount,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: response.bonus,
    });
    return res.json(response);
  }

  if (action === 'cashout' || action === 'redeem') {
    const winAmount = effectiveBetAmount;
    userState.balance = Math.max(0, userState.balance + winAmount);
    const result = action === 'redeem' ? 'redeemed' : 'cashout';
    if (eggId) {
      userState.eggs.delete(eggId);
    }
    const response = {
      apiStatus: 'ok',
      status: 2,
      result,
      winAmount,
      chargeAmount: 0,
      balance: userState.balance,
      eggId,
      eggType: effectiveEggType,
      tryIndex: 0,
      level: buildLevel(0),
      bonus: false,
      serverTime: now,
    };
    writeLog({
      time: now,
      userId,
      token,
      action,
      eggId,
      eggType: effectiveEggType,
      requestTryIndex,
      serverTryIndex,
      level: response.level,
      betAmount,
      effectiveBetAmount,
      result: response.result,
      status: response.status,
      winAmount: response.winAmount,
      balanceBefore,
      balanceAfter: userState.balance,
      bonus: response.bonus,
    });
    return res.json(response);
  }

  const baseWinChance = 0.5 / Math.pow(2, Math.max(0, serverTryIndex));
  const bonusChance = Math.min(0.01, baseWinChance);
  const normalWinChance = Math.max(0, baseWinChance - bonusChance);
  const roll = Math.random();
  const didWin = FORCE_WIN ? true : roll < bonusChance + normalWinChance;
  const didBonus = FORCE_BONUS ? didWin : roll < bonusChance;
  const winAmount = didWin ? effectiveBetAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = state?.hasCracked ? effectiveBetAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, MAX_CRACKS) : 0;
  if (result === 'lose' && eggId) {
    userState.eggs.delete(eggId);
  } else if (eggId) {
    state.hasCracked = true;
    state.tries = nextTryIndex;
    state.eggType = effectiveEggType;
    userState.eggs.set(eggId, state);
  }
  const response = {
    apiStatus: 'ok',
    status: buildStatus(result),
    result,
    winAmount,
    chargeAmount,
    balance: userState.balance,
    eggId,
    eggType: effectiveEggType,
    tryIndex: nextTryIndex,
    level: buildLevel(nextTryIndex),
    bonus: didBonus,
    serverTime: now,
  };
  writeLog({
    time: now,
    userId,
    token,
    action,
    eggId,
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
  return res.json(response);
});

app.listen(PORT, () => {
  console.log(`Golden Eggs microservice listening on http://localhost:${PORT}`);
});
