import { Container, Graphics, Text } from 'pixi.js';

export class AppGame {
  constructor({ app, userId, lang, onAction }) {
    this.app = app;
    this.userId = userId;
    this.lang = lang;
    this.onAction = onAction;
    this.betSizes = [1, 5, 10];
    this.currency = '';
    this.currentBet = this.betSizes[0];
    this.isLocked = false;

    this.root = new Container();
    this.app.stage.addChild(this.root);

    this._buildScene();
    this.resize(app.renderer.width, app.renderer.height);
  }

  _buildScene() {
    const { renderer } = this.app;

    this.backdrop = new Graphics();
    this.root.addChild(this.backdrop);

    this.egg = new Graphics();
    this.root.addChild(this.egg);

    this.titleText = new Text('Lunar Gold Smash', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 36,
      fontWeight: '900',
      fill: 0xffd54f,
      stroke: '#7c0f0f',
      strokeThickness: 3,
      align: 'center',
    });
    this.titleText.anchor.set(0.5, 0);
    this.root.addChild(this.titleText);

    this.balanceText = new Text('Balance: --', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 22,
      fontWeight: '700',
      fill: 0xfff1c1,
    });
    this.balanceText.anchor.set(0.5, 0);
    this.root.addChild(this.balanceText);

    this.statusText = new Text('Loading...', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 18,
      fill: 0xffeb3b,
      align: 'center',
    });
    this.statusText.anchor.set(0.5, 0);
    this.root.addChild(this.statusText);

    this.betText = new Text('Bet: --', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 18,
      fill: 0xffffff,
    });
    this.betText.anchor.set(0.5, 0);
    this.root.addChild(this.betText);

    this.actionButton = this._createButton('Smash the Egg', () => {
      if (this.isLocked || !this.onAction) return;
      this.onAction(this.currentBet);
    });
    this.root.addChild(this.actionButton);

    this.betButton = this._createButton('Change Bet', () => {
      if (this.isLocked) return;
      this._cycleBet();
    }, { width: 180, height: 54, color: 0xb71c1c });
    this.root.addChild(this.betButton);

    this._drawBackdrop(renderer.width, renderer.height);
    this._drawEgg(renderer.width / 2, renderer.height / 2);
  }

  _createButton(label, onPress, options = {}) {
    const width = options.width ?? 220;
    const height = options.height ?? 64;
    const color = options.color ?? 0xd32f2f;
    const container = new Container();
    const bg = new Graphics();
    bg.beginFill(color);
    bg.drawRoundedRect(0, 0, width, height, 14);
    bg.endFill();
    const glow = new Graphics();
    glow.lineStyle(3, 0xfff176);
    glow.drawRoundedRect(-2, -2, width + 4, height + 4, 16);

    const text = new Text(label, {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 18,
      fontWeight: '700',
      fill: 0xffffff,
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2);

    container.addChild(bg, glow, text);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', onPress);

    return container;
  }

  _drawBackdrop(width, height) {
    this.backdrop.clear();
    this.backdrop.removeChildren();
    this.backdrop.beginFill(0x2b0d0d);
    this.backdrop.drawRect(0, 0, width, height);
    this.backdrop.endFill();

    const frame = new Graphics();
    frame.lineStyle(6, 0xffd54f, 1);
    frame.drawRoundedRect(10, 10, width - 20, height - 20, 18);
    this.backdrop.addChild(frame);
  }

  _drawEgg(centerX, centerY) {
    const eggWidth = 220;
    const eggHeight = 300;

    this.eggCenter = { x: centerX, y: centerY, width: eggWidth, height: eggHeight };

    this.egg.clear();
    this.egg.beginFill(0xd4af37);
    this.egg.drawEllipse(centerX, centerY, eggWidth / 2, eggHeight / 2);
    this.egg.endFill();

    this.egg.lineStyle(6, 0xf9e1a3);
    this.egg.drawEllipse(centerX, centerY, (eggWidth / 2) * 0.85, (eggHeight / 2) * 0.9);
    this.egg.lineStyle();

    this.egg.beginFill(0xfff8e1, 0.8);
    this.egg.drawEllipse(centerX + eggWidth * 0.15, centerY - eggHeight * 0.2, eggWidth * 0.2, eggHeight * 0.15);
    this.egg.endFill();
  }

  _cycleBet() {
    if (!this.betSizes?.length) return;
    const currentIndex = this.betSizes.indexOf(this.currentBet);
    const nextIndex = (currentIndex + 1) % this.betSizes.length;
    this.currentBet = this.betSizes[nextIndex];
    this._updateBetText();
  }

  _updateBetText() {
    const currency = this.currency ? `${this.currency} ` : '';
    this.betText.text = `Bet: ${currency}${this.currentBet}`;
  }

  setConfig(config = {}) {
    if (Array.isArray(config.betSizes) && config.betSizes.length > 0) {
      this.betSizes = config.betSizes;
      this.currentBet = this.betSizes[0];
    }
    if (config.currency) {
      this.currency = config.currency;
    }
    this._updateBetText();
  }

  updateBalance(amount) {
    const currency = this.currency ? `${this.currency} ` : '';
    this.balanceText.text = `Balance: ${currency}${amount ?? '--'}`;
  }

  showLoading(message) {
    this.statusText.style.fill = 0xffeb3b;
    this.statusText.text = message;
    this.lockUI(true);
  }

  showError(message) {
    this.statusText.style.fill = 0xff8a80;
    this.statusText.text = message;
  }

  ready() {
    this.statusText.style.fill = 0xa5ff78;
    this.statusText.text = 'Ready! Smash for your New Year fortune.';
    this.lockUI(false);
  }

  showResult(result = {}) {
    const { result: outcome, winAmount = 0, balance } = result;
    if (balance !== undefined) {
      this.updateBalance(balance);
    }

    if (outcome === 'win') {
      this.statusText.style.fill = 0x8cff66;
      this.statusText.text = `恭喜发财！ +${this.currency}${winAmount}`;
      this._flashEgg(0x9ccc65);
    } else if (outcome === 'lose') {
      this.statusText.style.fill = 0xffccbc;
      this.statusText.text = 'Oops! The egg cracked. Try again.';
      this._flashEgg(0xff7043);
    } else {
      this.statusText.style.fill = 0xffeb3b;
      this.statusText.text = 'Action completed.';
      this._flashEgg(0xfff9c4);
    }
  }

  _flashEgg(color) {
    const { x, y, width, height } = this.eggCenter || { x: 0, y: 0, width: 120, height: 160 };
    const overlay = new Graphics();
    overlay.beginFill(color, 0.35);
    overlay.drawEllipse(x, y, width / 2, height / 2);
    overlay.endFill();
    overlay.alpha = 1;
    this.root.addChild(overlay);

    const fadeSteps = 20;
    let step = 0;

    const tick = () => {
      step += 1;
      overlay.alpha = Math.max(0, 1 - step / fadeSteps);
      if (step >= fadeSteps) {
        this.app.ticker.remove(tick);
        overlay.destroy();
      }
    };

    this.app.ticker.add(tick);
  }

  lockUI(isLocked) {
    this.isLocked = isLocked;
    const alpha = isLocked ? 0.6 : 1;
    const mode = isLocked ? 'none' : 'static';
    [this.actionButton, this.betButton].forEach((btn) => {
      btn.alpha = alpha;
      btn.eventMode = mode;
    });
  }

  resize(width, height) {
    this._drawBackdrop(width, height);
    this._drawEgg(width / 2, height / 2);

    this.titleText.position.set(width / 2, 24);
    this.balanceText.position.set(width / 2, 72);
    this.betText.position.set(width / 2, height - 180);
    this.actionButton.position.set((width - this.actionButton.width) / 2, height - 140);
    this.betButton.position.set((width - this.betButton.width) / 2, height - 70);
    this.statusText.position.set(width / 2, height - 230);
  }
}
