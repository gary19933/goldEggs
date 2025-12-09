import { Container, Graphics, Text } from 'pixi.js';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

export class AppGame {
  constructor({ app, userId, lang, onAction }) {
    this.app = app;
    this.userId = userId;
    this.lang = lang;
    this.onAction = onAction;

    this.eggs = [];
    this.savedEggs = [];
    this.selectedEggId = null;
    this.selectedSource = 'main'; // 'main' | 'saved'
    this.mainEggIndex = 0;
    this.currency = '';
    this.currentBet = 0;

    this.isLocked = false;
    this.isCracked = false;
    this._statusBgColor = 0xfff7cf;
    this._statusTextColor = 0xffeb3b;
    this._activeAnim = null;

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
    this.crackOverlay = new Graphics();
    this.root.addChild(this.egg);
    this.root.addChild(this.crackOverlay);

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

    this.statusBg = new Graphics();
    this.root.addChild(this.statusBg);

    this.statusText = new Text('Loading...', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 16,
      fontWeight: '700',
      fill: this._statusTextColor,
      align: 'center',
    });
    this.statusText.anchor.set(0.5, 0.5);
    this.root.addChild(this.statusText);
    this.statusBg.visible = false;
    this.statusText.visible = false;

    this.currentEggChip = new Container();
    this.root.addChild(this.currentEggChip);

    this.savedEggsContainer = new Container();
    this.root.addChild(this.savedEggsContainer);

    this.actionButton = this._createButton('Smash the Egg', () => {
      if (this.isLocked || !this.onAction) return;
      this.onAction({
        betAmount: this.currentBet,
        eggId: this.selectedEggId,
      });
    });
    this.root.addChild(this.actionButton);

    this.saveButton = this._createButton('Store Egg', () => {
      if (this.isLocked) return;
      this._stashCurrentEgg();
    }, { width: 180, height: 54, color: 0x7c3e00 });
    this.root.addChild(this.saveButton);

    this._drawBackdrop(renderer.width, renderer.height);
    this._drawEgg(renderer.width / 2, renderer.height / 2);
    this._refreshStatusBadge();
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

    this._drawCrackOverlay();
  }

  _updateBetText() {}

  setConfig(config = {}) {
    if (Array.isArray(config.eggs) && config.eggs.length > 0) {
      this.eggs = config.eggs;
      this.mainEggIndex = 0;
      this.selectedSource = 'main';
      this.selectedEggId = this.eggs[0]?.id ?? null;
      this.currentBet = this.eggs[0]?.bet ?? this.currentBet;
    }
    if (config.currency) {
      this.currency = config.currency;
    }
    this._renderCurrentEggChip();
    this._renderSavedEggs();
  }

  updateBalance(amount) {
    const currency = this.currency ? `${this.currency} ` : '';
    this.balanceText.text = `Balance: ${currency}${amount ?? '--'}`;
  }

  showLoading(message) {
    this._setStatus(message, 0xffeb3b, 0xfff7cf);
    this.lockUI(true);
  }

  showError(message) {
    this._setStatus(message, 0xff8a80, 0xffe0e0);
    this._showToast(message, 'error');
  }

  ready() {
    this._setStatus('Ready! Smash to reveal your fortune.', 0x8cff66, 0xe4ffd8);
    this.lockUI(false);
  }

  async showResult(result = {}) {
    const { result: outcome, winAmount = 0, balance } = result;
    if (balance !== undefined) {
      this.updateBalance(balance);
    }

    this.isCracked = true;
    this._drawCrackOverlay();
    await this._playBreakAnimation();

    if (outcome === 'win') {
      this._setStatus(`Fortune found! +${this.currency}${winAmount}`, 0x8cff66, 0xe4ffd8);
      this._flashEgg(0x9ccc65);
      this._showToast(`Fortune found! +${this.currency}${winAmount}`, 'success');
    } else if (outcome === 'lose') {
      this._setStatus('Egg cracked - no reward this time. Try again!', 0xffccbc, 0x2d0d0d);
      this._flashEgg(0xff7043);
      this._showToast('Egg cracked - no reward this time. Try again!', 'error');
    } else {
      this._setStatus('Action completed.', 0xffeb3b, 0xfff7cf);
      this._flashEgg(0xfff9c4);
      this._showToast('Action completed.', 'info');
    }

    if (this.selectedSource === 'main' && this.eggs.length > 0) {
      if (outcome === 'win') {
        this.mainEggIndex = (this.mainEggIndex + 1) % this.eggs.length;
      } else {
        this.mainEggIndex = 0;
      }
      this._selectMainEgg();
    } else if (this.selectedSource === 'saved') {
      if (outcome === 'win') {
        this.savedEggs = this.savedEggs.filter((egg) => egg.id !== this.selectedEggId);
      }
      this._selectMainEgg();
      this._renderSavedEggs();
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

  _setStatus(message, textColor, bgColor) {
    this.statusText.text = message;
    this.statusText.style.fill = textColor;
    this._statusBgColor = bgColor;
    this._statusTextColor = textColor;
    this._refreshStatusBadge();
  }

  _getSelectedEgg() {
    if (!this.selectedEggId) return null;
    if (this.selectedSource === 'saved') {
      return this.savedEggs.find((egg) => egg.id === this.selectedEggId) || null;
    }
    return this.eggs.find((egg) => egg.id === this.selectedEggId) || null;
  }

  _refreshStatusBadge() {
    if (!this.statusBg || !this.statusText) return;
    if (!this.statusBg.visible && !this.statusText.visible) return;
    const paddingX = 16;
    const paddingY = 10;
    const textWidth = this.statusText.width;
    const textHeight = this.statusText.height;
    const badgeWidth = textWidth + paddingX * 2;
    const badgeHeight = textHeight + paddingY * 2;

    this.statusBg.clear();
    this.statusBg.beginFill(this._statusBgColor, 0.92);
    this.statusBg.drawRoundedRect(
      this.statusText.x - badgeWidth / 2,
      this.statusText.y - badgeHeight / 2,
      badgeWidth,
      badgeHeight,
      12,
    );
    this.statusBg.endFill();
  }

  _drawCrackOverlay() {
    this.crackOverlay.clear();
    if (!this.isCracked || !this.eggCenter) return;

    const { x, y, width, height } = this.eggCenter;
    const crackColor = 0x4c1a1a;
    this.crackOverlay.lineStyle(6, crackColor, 1);

    const boltPoints = [
      [x, y - height * 0.35],
      [x - width * 0.1, y - height * 0.08],
      [x + width * 0.12, y - height * 0.02],
      [x - width * 0.08, y + height * 0.18],
      [x + width * 0.06, y + height * 0.32],
    ];
    this.crackOverlay.moveTo(boltPoints[0][0], boltPoints[0][1]);
    for (let i = 1; i < boltPoints.length; i += 1) {
      this.crackOverlay.lineTo(boltPoints[i][0], boltPoints[i][1]);
    }

    this.crackOverlay.beginFill(0x2d0d0d, 0.25);
    this.crackOverlay.drawPolygon([
      x - width * 0.05, y - height * 0.35,
      x + width * 0.08, y - height * 0.05,
      x - width * 0.06, y + height * 0.25,
      x + width * 0.03, y + height * 0.35,
    ]);
    this.crackOverlay.endFill();
  }

  _showToast(message, type) {
    const bg = type === 'success' ? '#133813'
      : type === 'error' ? '#3c1212'
      : '#1d1d2b';
    const color = type === 'success' ? '#b8ffb0'
      : type === 'error' ? '#ffc7c7'
      : '#cfd8ff';

    Swal.fire({
      text: message,
      toast: true,
      position: 'top',
      icon: type,
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: bg,
      color,
    });
  }

  _playBreakAnimation() {
    if (this._activeAnim) {
      this._activeAnim();
      this._activeAnim = null;
    }

    const { x, y, width, height } = this.eggCenter || { x: 0, y: 0, width: 200, height: 260 };
    const leftShell = new Graphics();
    const rightShell = new Graphics();
    const flash = new Graphics();

    const shellFill = 0xf5d586;
    const shellStroke = 0xb88c1a;

    const drawShellHalf = (gfx, side) => {
      gfx.clear();
      gfx.lineStyle(3, shellStroke, 1);
      gfx.beginFill(shellFill, 0.95);
      const dir = side === 'left' ? -1 : 1;
      gfx.drawPolygon([
        x + dir * 10, y - height * 0.2,
        x + dir * (width * 0.25), y,
        x + dir * 12, y + height * 0.25,
        x + dir * (width * 0.18), y + height * 0.42,
        x + dir * 4, y + height * 0.35,
        x + dir * (width * 0.14), y + height * 0.08,
      ]);
      gfx.endFill();
    };

    drawShellHalf(leftShell, 'left');
    drawShellHalf(rightShell, 'right');

    leftShell.alpha = 0.95;
    rightShell.alpha = 0.95;
    flash.alpha = 0;

    this.root.addChild(leftShell, rightShell, flash);

    let frame = 0;
    const duration = 50;
    const baseY = y - height * 0.05;

    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeIn = (t) => Math.pow(t, 2);

    const tick = () => {
      frame += 1;
      const t = Math.min(1, frame / duration);
      const eased = easeOut(t);
      const fall = easeIn(t);

      leftShell.position.set(-width * 0.08 * eased, (height * 0.55) * fall);
      leftShell.rotation = -0.2 * eased;
      leftShell.alpha = 0.95 * (1 - t * 0.4);

      rightShell.position.set(width * 0.08 * eased, (height * 0.55) * fall);
      rightShell.rotation = 0.2 * eased;
      rightShell.alpha = 0.95 * (1 - t * 0.4);

      flash.clear();
      if (t > 0.35) {
        const flashT = (t - 0.35) / 0.65;
        flash.beginFill(0xfff5b0, 0.45 * (1 - flashT * 0.7));
        flash.drawEllipse(x, baseY, width * (0.2 + 0.3 * flashT), height * (0.12 + 0.25 * flashT));
        flash.endFill();
        flash.alpha = 0.8 * (1 - flashT * 0.5);
      }

      if (frame >= duration) {
        this.app.ticker.remove(tick);
        leftShell.destroy();
        rightShell.destroy();
        flash.destroy();
        this._activeAnim = null;
        resolveFn();
      }
    };

    let resolveFn = () => {};
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
      this.app.ticker.add(tick);
    });

    this._activeAnim = () => {
      this.app.ticker.remove(tick);
      leftShell.destroy();
      rightShell.destroy();
      flash.destroy();
      resolveFn();
    };

    return promise;
  }

  _playStoreAnimation() {
    if (!this.eggCenter) return Promise.resolve();
    const width = this.app?.renderer?.width || 800;
    const height = this.app?.renderer?.height || 600;
    const start = { x: this.eggCenter.x, y: this.eggCenter.y };
    const target = { x: width / 2, y: this._getSavedRowY(height) };

    const token = new Graphics();
    token.beginFill(0xffd54f);
    token.drawCircle(0, 0, 18);
    token.endFill();
    token.alpha = 0.95;
    token.position.set(start.x, start.y);
    this.root.addChild(token);

    let frame = 0;
    const duration = 36;
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    let resolveFn = () => {};
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
      const tick = () => {
        frame += 1;
        const t = Math.min(1, frame / duration);
        const e = easeInOut(t);
        token.position.set(
          start.x + (target.x - start.x) * e,
          start.y + (target.y - start.y) * e,
        );
        token.scale.set(1 - 0.3 * e);
        token.alpha = 0.95 * (1 - 0.4 * e);

        if (frame >= duration) {
          this.app.ticker.remove(tick);
          token.destroy();
          this._flashSavedRow();
          resolveFn();
        }
      };
      this.app.ticker.add(tick);
    });

    return promise;
  }

  _renderCurrentEggChip(xPos, yPos) {
    if (!this.currentEggChip) return;
    this.currentEggChip.removeChildren();
    const egg = this._getSelectedEgg();
    if (!egg) return;
    const label = `${egg.label ?? egg.id ?? 'Egg'} • ${this.currency ? this.currency + ' ' : ''}${egg.bet ?? ''}`;

    const paddingX = 14;
    const paddingY = 8;
    const text = new Text(label, {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 16,
      fontWeight: '700',
      fill: 0x2b0d0d,
    });
    text.anchor.set(0.5, 0.5);

    const bg = new Graphics();
    const width = text.width + paddingX * 2;
    const height = text.height + paddingY * 2;
    bg.beginFill(0xffd54f, 0.95);
    bg.drawRoundedRect(0, 0, width, height, 12);
    bg.endFill();

    text.position.set(width / 2, height / 2);

    this.currentEggChip.addChild(bg, text);
    const x = (xPos ?? this.app?.renderer?.width / 2) - width / 2;
    const y = yPos ?? (this.app?.renderer?.height || 600) * 0.60;
    this.currentEggChip.position.set(x, y);
  }

  _flashSavedRow() {
    const width = this.app?.renderer?.width || 800;
    const height = this.app?.renderer?.height || 600;
    const y = this._getSavedRowY(height);
    const glow = new Graphics();
    glow.beginFill(0xffd54f, 0.25);
    glow.drawRoundedRect(width / 2 - 200, y - 24, 400, 48, 14);
    glow.endFill();
    this.root.addChild(glow);

    let frame = 0;
    const duration = 24;
    const tick = () => {
      frame += 1;
      glow.alpha = Math.max(0, 1 - frame / duration);
      if (frame >= duration) {
        this.app.ticker.remove(tick);
        glow.destroy();
      }
    };
    this.app.ticker.add(tick);
  }

  _renderSavedEggs() {
    if (!this.savedEggsContainer) return;
    this.savedEggsContainer.removeChildren();
    if (!this.savedEggs.length) return;

    const width = this.app?.renderer?.width || 800;
    const gap = 12;
    const buttons = this.savedEggs.map((egg) =>
      this._createSavedChip(egg, this.selectedSource === 'saved' && egg.id === this.selectedEggId),
    );
    let totalWidth = buttons.reduce((sum, b) => sum + b.width, 0) + gap * (buttons.length - 1);
    let startX = (width - totalWidth) / 2;
    const y = this._getSavedRowY();

    buttons.forEach((btn) => {
      btn.position.set(startX, y);
      this.savedEggsContainer.addChild(btn);
      startX += btn.width + gap;
    });
  }

  _createSavedChip(egg, isSelected) {
    const container = new Container();
    const paddingX = 12;
    const paddingY = 6;
    const label = `${egg.label ?? egg.id ?? 'Egg'} • ${this.currency ? this.currency + ' ' : ''}${egg.bet ?? ''}`;
    const text = new Text(label, {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 14,
      fontWeight: '700',
      fill: isSelected ? 0x2b0d0d : 0xfff1c1,
    });
    text.anchor.set(0.5, 0.5);

    const bg = new Graphics();
    const width = text.width + paddingX * 2;
    const height = text.height + paddingY * 2;
    bg.beginFill(isSelected ? 0xffd54f : 0x5d1919, 0.95);
    bg.drawRoundedRect(0, 0, width, height, 10);
    bg.endFill();

    text.position.set(width / 2, height / 2);

    container.addChild(bg, text);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', () => this._selectEgg(egg, 'saved'));

    container.width = width;
    container.height = height;
    return container;
  }

  _getSavedRowY(height = this.app?.renderer?.height || 600) {
    return Math.min(height * 0.72, height - 140);
  }

  _renderEggOptions() {}

  _selectEgg(egg, source = 'main') {
    if (!egg) return;
    this.selectedSource = source;
    this.selectedEggId = egg.id;
    if (typeof egg.bet === 'number') {
      this.currentBet = egg.bet;
    }
    if (source === 'main') {
      const idx = this.eggs.findIndex((e) => e.id === egg.id);
      if (idx >= 0) this.mainEggIndex = idx;
    }
    this._renderCurrentEggChip();
  }

  _selectMainEgg() {
    if (!this.eggs.length) return;
    const egg = this.eggs[this.mainEggIndex % this.eggs.length];
    this.selectedSource = 'main';
    this.selectedEggId = egg.id;
    if (typeof egg.bet === 'number') this.currentBet = egg.bet;
    this._renderCurrentEggChip();
  }

  async _stashCurrentEgg() {
    const egg = this._getSelectedEgg();
    if (!egg) {
      this._showToast('Select an egg first.', 'info');
      return;
    }
    if (this.selectedSource === 'saved') {
      this._showToast('This egg is already stored.', 'info');
      return;
    }
    if (this.savedEggs.length >= 3) {
      this._showToast('Storage is full (max 3).', 'error');
      return;
    }
    const exists = this.savedEggs.some((e) => e.id === egg.id);
    if (exists) {
      this._showToast('This egg is already stored.', 'info');
      return;
    }
    await this._playStoreAnimation();
    this.savedEggs.push({ ...egg });
    this._renderSavedEggs();
    this._showToast(`Stored: ${egg.label ?? egg.id}`, 'success');

    if (this.eggs.length > 0) {
      this.mainEggIndex = (this.mainEggIndex + 1) % this.eggs.length;
      this._selectMainEgg();
    }
  }

  lockUI(isLocked) {
    this.isLocked = isLocked;
    const alpha = isLocked ? 0.6 : 1;
    const mode = isLocked ? 'none' : 'static';
    [this.actionButton, this.saveButton].forEach((btn) => {
      btn.alpha = alpha;
      btn.eventMode = mode;
    });
  }

  resize(width, height) {
    this._drawBackdrop(width, height);
    const centerY = height * 0.38;
    this._drawEgg(width / 2, centerY);

    this.titleText.position.set(width / 2, 24);
    this.balanceText.position.set(width / 2, 70);
    this.statusText.position.set(width / 2, 110);
    this._refreshStatusBadge();

    const actionH = this.actionButton?.height || 64;
    const saveH = this.saveButton?.height || 64;
    const marginBottom = 24;
    const actionY = Math.min(height * 0.83, height - (actionH + saveH + marginBottom));
    const saveY = actionY + actionH + 12;

    this.actionButton.position.set((width - this.actionButton.width) / 2, actionY);
    this.saveButton.position.set((width - this.saveButton.width) / 2, Math.min(saveY, height - 60));

    this._renderCurrentEggChip(width / 2, height * 0.62);
    this._renderSavedEggs();
  }
}
