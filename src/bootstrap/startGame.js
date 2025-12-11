import { Application } from 'pixi.js';
import { initGame, gameAction, SHOULD_MOCK } from '../api/gameApi.js';
import { AppGame } from '../game/AppGame.js';

/**
 * Shared game bootstrap used by iframe (index.html) and JS SDK.
 * Returns a handle with destroy() to tear down.
 */
export async function startGame(options = {}) {
  const {
    container,
    userId = '',
    token = '',
    lang = 'en',
    onResult,
    width,
    height,
    enableResize = true,
    allowGuest = SHOULD_MOCK,
  } = options;

  if (!container) {
    throw new Error('startGame requires a DOM container.');
  }

  const app = new Application();

  const resolveAuth = () => {
    if (userId && token) return { userId, token, isGuest: false };
    if (allowGuest) return { userId: 'guest', token: 'guest-token', isGuest: true };
    return null;
  };

  const resolveWidth = () => {
    if (width) return width;
    const containerWidth = container.clientWidth || 0;
    const viewportWidth = window.innerWidth || 0;
    return Math.max(containerWidth, viewportWidth, 320);
  };

  const resolveHeight = () => {
    if (height) return height;
    const containerHeight = container.clientHeight || 0;
    const viewportHeight = window.innerHeight || 0;
    return Math.max(containerHeight, viewportHeight, 320);
  };

  const targetWidth = resolveWidth();
  const targetHeight = resolveHeight();

  await app.init({
    width: targetWidth,
    height: targetHeight,
    background: '#1a0a0a',
    antialias: true,
  });

  container.appendChild(app.canvas);

  const game = new AppGame({
    app,
    userId,
    lang,
    containerElement: container,
    onAction: handleAction,
  });

  if (enableResize) {
    const onResize = () => {
      const newWidth = resolveWidth();
      const newHeight = resolveHeight();
      app.renderer.resize(newWidth, newHeight);
      game.resize(newWidth, newHeight);
    };
    window.addEventListener('resize', onResize);

    // store for cleanup
    game._onResize = onResize;
  }

  try {
    game.showLoading('Connecting to game...');
    const auth = resolveAuth();
    const initResponse = await initGame({
      userId: auth?.userId ?? '',
      token: auth?.token ?? '',
      lang,
    });
    game.setConfig(initResponse?.config);
    game.updateBalance(initResponse?.balance ?? 0);
    game.ready();
  } catch (error) {
    console.error('Init error', error);
    game.showError('Failed to initialize game.');
  }

  async function handleAction(actionPayload) {
    const auth = resolveAuth();
    if (!auth) {
      game.showError('Missing user credentials. Check URL params.');
      return;
    }

    game.lockUI(true);

    try {
      const betAmount =
        typeof actionPayload === 'number' ? actionPayload : actionPayload?.betAmount;
      const eggId = typeof actionPayload === 'object' ? actionPayload?.eggId : undefined;
      const action =
        (typeof actionPayload === 'object' && actionPayload?.action) || 'spin';
      const tryIndex =
        typeof actionPayload === 'object' && typeof actionPayload.tryIndex === 'number'
          ? actionPayload.tryIndex
          : undefined;

      const result = await gameAction({
        userId: auth.userId,
        token: auth.token,
        action,
        betAmount,
        eggId,
        tryIndex,
      });

      await game.showResult(result);
      if (typeof onResult === 'function') {
        onResult({
          userId,
          result: result?.result,
          winAmount: result?.winAmount,
          balance: result?.balance,
          eggId: eggId ?? result?.eggId,
        });
      }
    } catch (error) {
      console.error('Action error', error);
      game.showError('Action failed, please retry.');
    } finally {
      game.lockUI(false);
    }
  }

  return {
    app,
    game,
    destroy() {
      if (game?._onResize) {
        window.removeEventListener('resize', game._onResize);
      }
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      if (container.contains(app.canvas)) {
        container.removeChild(app.canvas);
      }
    },
  };
}
