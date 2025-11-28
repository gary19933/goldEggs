import { startGame } from './bootstrap/startGame.js';

const params = new URLSearchParams(window.location.search);
const userId = params.get('userId') ?? '';
const token = params.get('token') ?? '';
const lang = params.get('lang') ?? 'en';

const root = document.querySelector('#game-root');
if (!root) {
  throw new Error('Missing #game-root container.');
}

startGame({
  container: root,
  userId,
  token,
  lang,
  onResult: (payload) => {
    window.parent?.postMessage(
      {
        type: 'GAME_RESULT',
        payload,
      },
      '*',
    );
  },
}).catch((error) => {
  console.error('Bootstrap error', error);
});
