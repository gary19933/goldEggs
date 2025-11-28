import { Application } from 'pixi.js';
import { initGame, gameAction } from '../api/gameApi.js';
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
  } = options;

  if (!container) {
    throw new Error('startGame requires a DOM container.');
  }

  const app = new Application();

  const targetWidth = width ?? Math.min(window.innerWidth || 800, 1024);
  const targetHeight = height ?? Math.min(window.innerHeight || 600, 720);

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
    onAction: handleAction,
  });

  if (enableResize) {
    const onResize = () => {
      const newWidth = Math.min(window.innerWidth || targetWidth, 1024);
      const newHeight = Math.min(window.innerHeight || targetHeight, 720);
      app.renderer.resize(newWidth, newHeight);
      game.resize(newWidth, newHeight);
    };
    window.addEventListener('resize', onResize);

    // store for cleanup
    game._onResize = onResize;
  }

  try {
    game.showLoading('Connecting to game...');
    const initResponse = await initGame({ userId, token, lang });
    game.setConfig(initResponse?.config);
    game.updateBalance(initResponse?.balance ?? 0);
    game.ready();
  } catch (error) {
    console.error('Init error', error);
    game.showError('Failed to initialize game.');
  }

  async function handleAction(betAmount) {
    if (!userId || !token) {
      game.showError('Missing user credentials. Check URL params.');
      return;
    }

    game.lockUI(true);

    try {
      const result = await gameAction({
        userId,
        token,
        action: 'spin',
        betAmount,
      });

      game.showResult(result);
      if (typeof onResult === 'function') {
        onResult({
          userId,
          result: result?.result,
          winAmount: result?.winAmount,
          balance: result?.balance,
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
