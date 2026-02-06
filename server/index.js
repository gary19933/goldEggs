import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MAX_CRACKS = 12;
const FORCE_BONUS = process.env.FORCE_BONUS === 'true';
const FORCE_WIN = process.env.FORCE_WIN === 'true';
const LOG_PATH = process.env.LOG_PATH || path.resolve('server', 'logs', 'transactions.jsonl');

let mockBalance = 1000;
const eggStates = new Map();

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

const getEggState = (eggId) => {
  if (!eggId) return null;
  if (!eggStates.has(eggId)) {
    eggStates.set(eggId, { hasCracked: false });
  }
  return eggStates.get(eggId);
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

  res.json({
    apiStatus: 'ok',
    userId,
    lang,
    balance: mockBalance,
    config: {
      eggs: [
        { id: 'gold', label: 'Gold Egg', bet: 100 },
        { id: 'premium', label: 'Premium Egg', bet: 1000 },
      ],
      currency: 'RM',
      maxStored: 3,
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
  const balanceBefore = mockBalance;
  const level = buildLevel(tryIndex);
  const now = new Date().toISOString();
  const state = getEggState(eggId) || { hasCracked: false };

  if (action === 'store') {
    const response = {
      apiStatus: 'ok',
      status: null,
      result: 'stored',
      winAmount: 0,
      chargeAmount: 0,
      balance: mockBalance,
      eggId,
      eggType,
      tryIndex,
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
      tryIndex,
      level,
      betAmount,
      result: response.result,
      status: response.status,
      winAmount: response.winAmount,
      balanceBefore,
      balanceAfter: mockBalance,
      bonus: response.bonus,
    });
    return res.json(response);
  }

  if (action === 'cashout' || action === 'redeem') {
    const winAmount = betAmount;
    mockBalance = Math.max(0, mockBalance + winAmount);
    const result = action === 'redeem' ? 'redeemed' : 'cashout';
    if (eggId) {
      eggStates.delete(eggId);
    }
    const response = {
      apiStatus: 'ok',
      status: 2,
      result,
      winAmount,
      chargeAmount: 0,
      balance: mockBalance,
      eggId,
      eggType,
      tryIndex,
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
      tryIndex,
      level,
      betAmount,
      result: response.result,
      status: response.status,
      winAmount: response.winAmount,
      balanceBefore,
      balanceAfter: mockBalance,
      bonus: response.bonus,
    });
    return res.json(response);
  }

  const baseWinChance = 0.5 / Math.pow(2, Math.max(0, tryIndex));
  const bonusChance = Math.min(0.01, baseWinChance);
  const normalWinChance = Math.max(0, baseWinChance - bonusChance);
  const roll = Math.random();
  const didWin = FORCE_WIN ? true : roll < bonusChance + normalWinChance;
  const didBonus = FORCE_BONUS ? didWin : roll < bonusChance;
  const winAmount = didWin ? betAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = state?.hasCracked ? betAmount : 0;
  mockBalance = Math.max(0, mockBalance + winAmount - chargeAmount);

  const result = didWin ? 'win' : 'lose';
  if (result === 'lose' && eggId) {
    eggStates.delete(eggId);
  } else if (eggId) {
    state.hasCracked = true;
    eggStates.set(eggId, state);
  }
  const response = {
    apiStatus: 'ok',
    status: buildStatus(result),
    result,
    winAmount,
    chargeAmount,
    balance: mockBalance,
    eggId,
    eggType,
    tryIndex,
    level,
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
    tryIndex,
    level,
    betAmount,
    chargeAmount,
    result: response.result,
    status: response.status,
    winAmount: response.winAmount,
    balanceBefore,
    balanceAfter: mockBalance,
    bonus: response.bonus,
  });
  return res.json(response);
});

app.listen(PORT, () => {
  console.log(`Golden Eggs microservice listening on http://localhost:${PORT}`);
});
