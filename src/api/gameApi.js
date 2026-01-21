const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const USE_MOCK = import.meta.env.VITE_API_USE_MOCK === 'true';
export const SHOULD_MOCK = USE_MOCK || (!rawBaseUrl && import.meta.env.DEV);
const FORCE_BONUS = import.meta.env.VITE_FORCE_BONUS === 'true';
const FORCE_WIN = import.meta.env.VITE_FORCE_WIN === 'true';

let mockBalance = 1000;

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
  const { lang = 'en' } = payload;
  return Promise.resolve({
    status: 'ok',
    balance: mockBalance,
    config: {
      betSizes: [1, 5, 10],
      eggs: [
        // Multiple entries to demo grouped counts (xN) in the UI.
        ...Array.from({ length: 30 }, () => ({ id: 'gold', label: 'Gold Egg', bet: 10 })),
        ...Array.from({ length: 30 }, () => ({ id: 'ruby', label: 'Ruby Egg', bet: 25 })),
        ...Array.from({ length: 30 }, () => ({ id: 'jade', label: 'Jade Egg', bet: 50 })),
        ...Array.from({ length: 30 }, () => ({ id: 'emerald', label: 'Emerald Egg', bet: 35 })),
        ...Array.from({ length: 30 }, () => ({ id: 'topaz', label: 'Topaz Egg', bet: 20 })),
      ],
      currency: 'UCOIN',
      maxStored: 3,
    },
    lang,
    mock: true,
  });
}

function mockAction(payload = {}) {
  const { betAmount = 1, eggId, action = 'crack', tryIndex = 0 } = payload;

  if (action === 'store') {
    return Promise.resolve({
      status: 'ok',
      result: 'stored',
      winAmount: 0,
      balance: mockBalance,
      eggId,
      tryIndex,
    });
  }

  if (action === 'cashout') {
    const winAmount = betAmount;
    return Promise.resolve({
      status: 'ok',
      result: 'cashout',
      winAmount,
      balance: mockBalance,
      eggId,
      tryIndex,
    });
  }

  const bonusChance = 0.01;
  const normalWinChance = 0.5 - bonusChance;
  const roll = Math.random();
  const didWin = FORCE_WIN ? true : roll < bonusChance + normalWinChance;
  const didBonus = FORCE_BONUS ? didWin : roll < bonusChance;
  const winAmount = didWin ? betAmount * (didBonus ? 2 : 1) : 0;
  mockBalance = Math.max(0, mockBalance + winAmount - betAmount);

  return Promise.resolve({
    status: 'ok',
    result: didWin ? 'win' : 'lose',
    winAmount,
    bonus: didBonus,
    balance: mockBalance,
    eggId,
    tryIndex,
    mock: true,
  });
}
