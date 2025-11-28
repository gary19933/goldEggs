import { startGame } from './bootstrap/startGame.js';

const GoldenEggs = {
  /**
   * Initialize the game inside a host page without iframe.
   * @param {Object} options
   * @param {HTMLElement} options.container - Mount point for the Pixi canvas.
   * @param {string} options.userId
   * @param {string} options.token
   * @param {string} [options.lang='en']
   * @param {function} [options.onResult] - Callback after each action.
   * @param {string} [options.apiBaseUrl] - Optional base URL override for fetch; pass via VITE_API_BASE_URL at build time or set globally.
   * @returns {Promise<{ destroy: () => void }>}
   */
  init(options) {
    return startGame(options);
  },
};

if (typeof window !== 'undefined') {
  window.GoldenEggs = GoldenEggs;
}

export default GoldenEggs;
