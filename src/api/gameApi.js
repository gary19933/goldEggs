const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const USE_MOCK = import.meta.env.VITE_API_USE_MOCK === 'true';
export const SHOULD_MOCK = USE_MOCK || (!rawBaseUrl && import.meta.env.DEV);
const FORCE_BONUS = import.meta.env.VITE_FORCE_BONUS === 'true';
const FORCE_WIN = import.meta.env.VITE_FORCE_WIN === 'true';
const MAX_CRACKS = 12;
const DEFAULT_BALANCE = 1000;

const mockUsers = new Map();

function getMockUserState(userId = '') {
  const key = userId || 'guest';
  if (!mockUsers.has(key)) {
    mockUsers.set(key, { balance: DEFAULT_BALANCE, eggs: new Map() });
  }
  return mockUsers.get(key);
}

function buildUrl(path) {
  if (!rawBaseUrl) return path;
  return `${rawBaseUrl}${path}`;
}

async function postJson(path, payload) {
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`API error ${response.status}: ${message}`);
  }

  return response.json();
}

export async function initGame(payload) {
  if (SHOULD_MOCK) {
    return mockInit(payload);
  }
  return postJson('/game/init', payload);
}

export async function gameAction(payload) {
  if (SHOULD_MOCK) {
    return mockAction(payload);
  }
  return postJson('/game/action', payload);
}

function mockInit(payload = {}) {
  const { lang = 'en', userId = '' } = payload;
  const userState = getMockUserState(userId);
  return Promise.resolve({
    apiStatus: 'ok',
    userId,
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
    lang,
    serverTime: new Date().toISOString(),
    mock: true,
  });
}

function mockAction(payload = {}) {
  const {
    userId = '',
    betAmount = 1,
    eggId,
    eggType = 'gold',
    action = 'crack',
  } = payload;
  const userState = getMockUserState(userId);

  let eggState = null;
  if (eggId) {
    eggState = userState.eggs.get(eggId);
    if (!eggState) {
      eggState = { hasCracked: false, tries: 0, eggType };
      userState.eggs.set(eggId, eggState);
    }
  }
  const serverTryIndex = eggState?.tries ?? 0;

  if (action === 'store') {
    return Promise.resolve({
      apiStatus: 'ok',
      status: null,
      result: 'stored',
      winAmount: 0,
      chargeAmount: 0,
      balance: userState.balance,
      eggId,
      eggType,
      tryIndex: serverTryIndex,
      level: Math.min(Math.max(serverTryIndex + 1, 1), MAX_CRACKS),
      serverTime: new Date().toISOString(),
    });
  }

  if (action === 'cashout' || action === 'redeem') {
    const winAmount = betAmount;
    userState.balance = Math.max(0, userState.balance + winAmount);
    if (eggId) {
      userState.eggs.delete(eggId);
    }
    return Promise.resolve({
      apiStatus: 'ok',
      status: 2,
      result: action === 'redeem' ? 'redeemed' : 'cashout',
      winAmount,
      chargeAmount: 0,
      balance: userState.balance,
      eggId,
      eggType,
      tryIndex: 0,
      level: 1,
      serverTime: new Date().toISOString(),
    });
  }

  const baseWinChance = 0.5 / Math.pow(2, Math.max(0, serverTryIndex));
  const bonusChance = Math.min(0.01, baseWinChance);
  const normalWinChance = Math.max(0, baseWinChance - bonusChance);
  const roll = Math.random();
  const didWin = FORCE_WIN ? true : roll < bonusChance + normalWinChance;
  const didBonus = FORCE_BONUS ? didWin : roll < bonusChance;
  const winAmount = didWin ? betAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = eggState?.hasCracked ? betAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);
  const nextTryIndex = didWin ? Math.min(serverTryIndex + 1, MAX_CRACKS) : 0;
  if (didWin && eggState) {
    eggState.hasCracked = true;
    eggState.tries = nextTryIndex;
    eggState.eggType = eggType;
    userState.eggs.set(eggId, eggState);
  } else if (!didWin && eggId) {
    userState.eggs.delete(eggId);
  }

  return Promise.resolve({
    apiStatus: 'ok',
    status: didWin ? 1 : 0,
    result: didWin ? 'win' : 'lose',
    winAmount,
    chargeAmount,
    bonus: didBonus,
    balance: userState.balance,
    eggId,
    eggType,
    tryIndex: nextTryIndex,
    level: Math.min(Math.max(nextTryIndex + 1, 1), MAX_CRACKS),
    serverTime: new Date().toISOString(),
    mock: true,
  });
}
