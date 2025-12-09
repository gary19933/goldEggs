const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const USE_MOCK = import.meta.env.VITE_API_USE_MOCK === 'true';
export const SHOULD_MOCK = USE_MOCK || (!rawBaseUrl && import.meta.env.DEV);

let mockBalance = 1000;
let mockWinChance = 0.5;

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
        { id: 'gold', label: '金蛋', bet: 1 },
        { id: 'ruby', label: '红蛋', bet: 5 },
        { id: 'jade', label: '玉蛋', bet: 10 },
      ],
      currency: 'CNY',
    },
    lang,
    mock: true,
  });
}

function mockAction(payload = {}) {
  const { betAmount = 1, eggId } = payload;
  const roll = Math.random();
  const didWin = roll < mockWinChance;

  let winAmount = 0;
  let outcome = 'lose';

  if (didWin) {
    const multiplier = 2 + Math.floor(Math.random() * 3); // 2x-4x
    winAmount = betAmount * multiplier;
    mockBalance += winAmount;
    mockWinChance = Math.max(0.2, mockWinChance - 0.05); // winning reduces odds
    outcome = 'win';
  } else {
    mockBalance = Math.max(0, mockBalance - betAmount);
    mockWinChance = Math.min(0.8, mockWinChance + 0.05); // losing bumps odds a bit
  }

  return Promise.resolve({
    status: 'ok',
    result: outcome,
    winAmount,
    balance: mockBalance,
    reels: [1, 2, 3],
    mock: true,
  });
}
