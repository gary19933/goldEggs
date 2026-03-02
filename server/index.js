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
      eggs: [
        { id: 'gold', label: 'Gold Egg', bet: 100 },
        { id: 'premium', label: 'Premium Egg', bet: 1000 },
      ],
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
      eggType,
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
      eggType,
      requestTryIndex,
      serverTryIndex,
      level,
      betAmount,
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
    const winAmount = betAmount;
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
      eggType,
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
      eggType,
      requestTryIndex,
      serverTryIndex,
      level: response.level,
      betAmount,
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
  const winAmount = didWin ? betAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = state?.hasCracked ? betAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, MAX_CRACKS) : 0;
  if (result === 'lose' && eggId) {
    userState.eggs.delete(eggId);
  } else if (eggId) {
    state.hasCracked = true;
    state.tries = nextTryIndex;
    state.eggType = eggType;
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
    eggType,
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
    eggType,
    requestTryIndex,
    serverTryIndex,
    level: response.level,
    betAmount,
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
