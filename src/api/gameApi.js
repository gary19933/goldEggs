const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const USE_MOCK = import.meta.env.VITE_API_USE_MOCK === 'true';
export const SHOULD_MOCK = USE_MOCK || (!rawBaseUrl && import.meta.env.DEV);
const FORCE_BONUS = import.meta.env.VITE_FORCE_BONUS === 'true';
const FORCE_WIN = import.meta.env.VITE_FORCE_WIN === 'true';
const MOCK_UNLIMITED_BUY = import.meta.env.VITE_MOCK_UNLIMITED_BUY === 'true';
const MAX_CRACKS = 12;
const MAX_HISTORY = 200;
const MAX_STORED = 3;
const DEFAULT_BALANCE = 1000;
const EGG_CONFIG = [
  { id: 'gold', label: 'Gold Egg', bet: 100 },
  { id: 'premium', label: 'Premium Egg', bet: 1000 },
];
const INFO_CONFIG = {
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
const EGG_CONFIG_BY_ID = EGG_CONFIG.reduce((acc, egg) => {
  acc[egg.id] = egg;
  return acc;
}, {});

const MOCK_STORAGE_KEY = 'gold-eggs-mock-state-v3';
const mockUsers = new Map();

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function serializeUserState(userState) {
  return {
    balance: userState.balance,
    history: userState.history.map((entry) => ({
      ...entry,
      time: entry.time instanceof Date ? entry.time.toISOString() : entry.time,
    })),
    activeEggUid: userState.activeEggUid || null,
    nextEggSeq: userState.nextEggSeq || 0,
    eggs: Array.from(userState.eggs.values()).map((egg) => ({ ...egg })),
  };
}

function hydrateUserState(rawState = {}) {
  return {
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
  };
}

function loadMockStore() {
  if (!canUseStorage() || mockUsers.size > 0) return;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.entries(parsed || {}).forEach(([userId, rawState]) => {
      mockUsers.set(userId, hydrateUserState(rawState));
    });
  } catch (error) {
    console.warn('Failed to load mock state:', error);
  }
}

function persistMockStore() {
  if (!canUseStorage()) return;
  try {
    const snapshot = Object.fromEntries(
      Array.from(mockUsers.entries()).map(([userId, userState]) => [userId, serializeUserState(userState)]),
    );
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Failed to persist mock state:', error);
  }
}

function getEggTemplate(eggType = 'gold') {
  return EGG_CONFIG_BY_ID[eggType] || EGG_CONFIG[0];
}

function getMockUserState(userId = '') {
  loadMockStore();
  const key = userId || 'guest';
  if (!mockUsers.has(key)) {
    mockUsers.set(key, {
      balance: DEFAULT_BALANCE,
      eggs: new Map(),
      history: [],
      activeEggUid: null,
      nextEggSeq: 0,
    });
    persistMockStore();
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
    const rawMessage = await response.text();
    let message = rawMessage;
    try {
      const parsed = JSON.parse(rawMessage);
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        message = parsed.message.trim();
      }
    } catch {
      // keep raw text when the response body is not JSON
    }
    throw new Error(message || `API error ${response.status}`);
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

export async function getGameHistory(payload) {
  if (SHOULD_MOCK) {
    const { userId = '' } = payload || {};
    const userState = getMockUserState(userId);
    return Promise.resolve({
      apiStatus: 'ok',
      balance: userState.balance,
      state: serializeState(userState),
      history: serializeState(userState).history,
      serverTime: new Date().toISOString(),
      mock: true,
    });
  }
  return postJson('/game/history', payload);
}

function makeEggUid(userState, eggType = 'gold') {
  userState.nextEggSeq += 1;
  return `${eggType}-${Date.now()}-${userState.nextEggSeq}`;
}

function createEggState(userState, eggType = 'gold', eggId) {
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
}

function serializeEgg(egg) {
  return {
    uid: egg.uid,
    id: egg.id,
    label: egg.label,
    bet: egg.bet,
    tries: egg.tries,
    hasCracked: egg.hasCracked,
    lastWinAmount: egg.lastWinAmount,
    isMaxed: egg.isMaxed,
  };
}

function serializeState(userState) {
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
}

function resolveBetAmount(eggType, tryIndex, fallbackBetAmount = 0) {
  const baseBet = EGG_CONFIG_BY_ID[eggType]?.bet;
  if (typeof baseBet !== 'number' || Number.isNaN(baseBet)) {
    return Math.max(0, Number(fallbackBetAmount) || 0);
  }
  const safeTryIndex = Math.max(0, Math.min(Number(tryIndex) || 0, MAX_CRACKS));
  return baseBet * Math.pow(2, safeTryIndex);
}

function recordHistory(userState, status, egg, extra = {}) {
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
}

function buildStatus(result) {
  if (result === 'win') return 1;
  if (result === 'lose') return 0;
  if (result === 'redeemed') return 2;
  return null;
}

function buildResponse(userState, payload = {}) {
  return {
    apiStatus: 'ok',
    balance: userState.balance,
    state: serializeState(userState),
    serverTime: new Date().toISOString(),
    mock: true,
    ...payload,
  };
}

function markCurrentStoredIfNeeded(userState, nextEggUid = null) {
  const currentEgg = userState.activeEggUid ? userState.eggs.get(userState.activeEggUid) : null;
  if (currentEgg && currentEgg.uid !== nextEggUid) {
    recordHistory(userState, 1, currentEgg, {
      actionType: 'stored',
      betAmount: currentEgg.bet,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: currentEgg.tries ?? 0,
    });
  }
}

function mockInit(payload = {}) {
  const { lang = 'en', userId = '' } = payload;
  const userState = getMockUserState(userId);
  return Promise.resolve({
    apiStatus: 'ok',
    userId,
    balance: userState.balance,
    config: {
      eggs: EGG_CONFIG,
      currency: 'RM',
      maxStored: MAX_STORED,
      maxCracks: MAX_CRACKS,
      info: {
        title: INFO_CONFIG.title,
        steps: [...INFO_CONFIG.steps],
      },
    },
    state: serializeState(userState),
    lang,
    serverTime: new Date().toISOString(),
    mock: true,
  });
}

function mockAction(payload = {}) {
  const {
    userId = '',
    betAmount = 0,
    eggId,
    eggType = 'gold',
    action = 'crack',
  } = payload;
  const userState = getMockUserState(userId);

  if (action === 'buy') {
    const purchaseCost = resolveBetAmount(eggType, 0, betAmount);
    if (userState.activeEggUid) {
      return Promise.reject(new Error('Active egg must be stored or finished before buying a new egg.'));
    }
    if (userState.eggs.size >= MAX_STORED) {
      return Promise.reject(new Error(`Storage is full (${MAX_STORED}/${MAX_STORED}).`));
    }
    if (!MOCK_UNLIMITED_BUY && userState.balance < purchaseCost) {
      return Promise.reject(new Error('Insufficient UCoins'));
    }
    markCurrentStoredIfNeeded(userState);
    const egg = createEggState(userState, eggType, eggId);
    egg.bet = purchaseCost;
    userState.eggs.set(egg.uid, egg);
    userState.activeEggUid = egg.uid;
    if (!MOCK_UNLIMITED_BUY) {
      userState.balance -= purchaseCost;
    }
    recordHistory(userState, 1, egg, {
      actionType: 'buy',
      betAmount: purchaseCost,
      chargeAmount: MOCK_UNLIMITED_BUY ? 0 : purchaseCost,
      winAmount: 0,
      tryIndex: 0,
    });
    persistMockStore();
    return Promise.resolve(buildResponse(userState, {
      status: null,
      result: 'bought',
      eggId: egg.uid,
      eggType: egg.id,
      betAmount: purchaseCost,
      chargeAmount: MOCK_UNLIMITED_BUY ? 0 : purchaseCost,
      winAmount: 0,
      tryIndex: 0,
      level: 1,
      bonus: false,
    }));
  }

  const egg = (eggId && userState.eggs.get(eggId)) || (userState.activeEggUid ? userState.eggs.get(userState.activeEggUid) : null);
  if (!egg) {
    return Promise.reject(new Error('Egg not found.'));
  }

  const serverTryIndex = egg.tries ?? 0;
  const effectiveEggType = egg.id || eggType;
  const effectiveBetAmount = resolveBetAmount(effectiveEggType, serverTryIndex, betAmount || egg.bet || 0);

  if (action === 'store') {
    if (userState.activeEggUid === egg.uid) {
      userState.activeEggUid = null;
    }
    recordHistory(userState, 1, egg, {
      actionType: 'stored',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: egg.tries ?? 0,
    });
    persistMockStore();
    return Promise.resolve(buildResponse(userState, {
      status: null,
      result: 'stored',
      winAmount: 0,
      chargeAmount: 0,
      eggId: egg.uid,
      eggType: egg.id,
      tryIndex: egg.tries ?? 0,
      level: Math.min(Math.max((egg.tries ?? 0) + 1, 1), MAX_CRACKS),
      bonus: false,
    }));
  }

  if (action === 'retrieve') {
    markCurrentStoredIfNeeded(userState, egg.uid);
    userState.activeEggUid = egg.uid;
    recordHistory(userState, 1, egg, {
      actionType: 'retrieve',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount: 0,
      tryIndex: egg.tries ?? 0,
    });
    persistMockStore();
    return Promise.resolve(buildResponse(userState, {
      status: null,
      result: 'retrieved',
      winAmount: 0,
      chargeAmount: 0,
      eggId: egg.uid,
      eggType: egg.id,
      tryIndex: egg.tries ?? 0,
      level: Math.min(Math.max((egg.tries ?? 0) + 1, 1), MAX_CRACKS),
      bonus: false,
    }));
  }

  // Redeem is a backoffice-only settlement after support verifies the player's screenshot.
  if (action === 'redeem') {
    const winAmount = effectiveBetAmount;
    userState.balance = Math.max(0, userState.balance + winAmount);
    userState.eggs.delete(egg.uid);
    if (userState.activeEggUid === egg.uid) {
      userState.activeEggUid = null;
    }
    recordHistory(userState, 2, egg, {
      actionType: 'redeemed',
      betAmount: effectiveBetAmount,
      chargeAmount: 0,
      winAmount,
      tryIndex: egg.tries ?? 0,
    });
    persistMockStore();
    return Promise.resolve(buildResponse(userState, {
      status: 2,
      result: 'redeemed',
      winAmount,
      chargeAmount: 0,
      eggId: egg.uid,
      eggType: egg.id,
      tryIndex: 0,
      level: 1,
      bonus: false,
    }));
  }

  userState.activeEggUid = egg.uid;
  const baseWinChance = 0.5 / Math.pow(2, Math.max(0, serverTryIndex));
  const bonusChance = 0.01;
  const didBonus = FORCE_BONUS ? true : Math.random() < bonusChance;
  const didWin = FORCE_WIN ? true : Math.random() < baseWinChance;
  const winAmount = didWin ? effectiveBetAmount * (didBonus ? 2 : 1) : 0;
  const chargeAmount = egg.hasCracked ? effectiveBetAmount : 0;
  userState.balance = Math.max(0, userState.balance + winAmount - chargeAmount);
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

  const result = didWin ? 'win' : 'lose';
  recordHistory(userState, buildStatus(result), egg, {
    actionType: result,
    betAmount: effectiveBetAmount,
    chargeAmount,
    winAmount,
    tryIndex: didWin ? nextTryIndex : serverTryIndex + 1,
  });
  persistMockStore();

  return Promise.resolve(buildResponse(userState, {
    status: didWin ? 1 : 0,
    result,
    winAmount,
    chargeAmount,
    bonus: didBonus,
    eggId: egg.uid,
    eggType: egg.id,
    tryIndex: nextTryIndex,
    level: Math.min(Math.max(nextTryIndex + 1, 1), MAX_CRACKS),
  }));
}
