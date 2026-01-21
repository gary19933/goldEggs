import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const makeUid = (() => {
  let counter = 0;
  return (prefix = 'egg') => `${prefix}-${Date.now()}-${counter++}`;
})();

/**
 * AppGame manages two views: Home (inventory/shop) and Play (crack page).
 * It keeps egg instances (bought, stored), enforces the 3-egg store cap,
 * and orchestrates button state for first try vs subsequent tries.
 */
export class AppGame {
  constructor({ app, userId, lang, onAction, containerElement }) {
    this.app = app;
    this.userId = userId;
    this.lang = lang;
    this.onAction = onAction;
    this.containerEl = containerElement || null;
    this.volume = 1;
    this.isMuted = false;
    this.audioCtx = null;
    this.gainNode = null;
    this.oscNode = null;
    this.isMusicOn = false;

    this.mode = 'home'; // 'home' | 'play' | 'info' | 'settings' | 'rewards'
    this.boughtEggs = [];
    this.storedEggs = [];
    this.maxStored = 3;
    this.currency = '';

    this.activeEggUid = null;
    this.activeSource = 'bought';
    this.isLocked = false;
    this.isCracked = false;
    this.lastResultText = '';
    this.lastBonus = false;
    this.history = [];
    this.cashoutHistory = [];
    this.activeTabId = 'gold';
    this.previousTabId = null;
    this._prevEggOnStoredLose = null;
    this.maxCracks = 5;

    this._statusBgColor = 0xfff7cf;
    this._statusTextColor = 0xffeb3b;
    this._activeAnim = null;
    this._bonusAnim = null;
    this._isKnocking = false;
    this._resultTimeout = null;
    this._storedBarTop = null;
    this._eggSpriteKey = null;

    this.root = new Container();
    this.app.stage.addChild(this.root);

    this._buildScene();
    this.resize(app.renderer.width, app.renderer.height);
  }

  // region setup ----------------------------------------------------------------
  _buildScene() {
    const { renderer } = this.app;

    this._setupHomeDom();
    this._setupControlsBar();
    this._setupModalShell();
    this._setupEggTabs();
    this._setupStoredBar();

    this.backdrop = new Graphics();
    this.root.addChild(this.backdrop);
    this._drawBackdrop(renderer.width, renderer.height);

    // this.titleText = new Text('Golden Eggs', {
    //   fontFamily: 'Segoe UI, Arial, sans-serif',
    //   fontSize: 32,
    //   fontWeight: '900',
    //   fill: 0xffd54f,
    //   stroke: '#7c0f0f',
    //   strokeThickness: 3,
    //   align: 'center',
    // });
    // this.titleText.anchor.set(0.5, 0);
    // this.root.addChild(this.titleText);

    this.statusBg = new Graphics();
    this.root.addChild(this.statusBg);

    this.statusText = new Text('', {
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

    // Play view pieces
    this.playContainer = new Container();
    this.root.addChild(this.playContainer);

    this.egg = new Graphics();
    this.crackOverlay = new Graphics();
    this.playContainer.addChild(this.egg);
    this.playContainer.addChild(this.crackOverlay);

    this.eggSpriteContainer = new Container();
    this.playContainer.addChild(this.eggSpriteContainer);
    this.fullEggSprite = null;
    this.brokenEggSprite = null;

    this.eggLabel = new Text('', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 18,
      fontWeight: '800',
      fill: 0xfff1c1,
    });
    this.eggLabel.anchor.set(0.5, 0.5);
    this.playContainer.addChild(this.eggLabel);

    this.triesText = new Text('', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 16,
      fontWeight: '700',
      fill: 0xffd54f,
    });
    this.triesText.anchor.set(0.5, 0.5);
    this.playContainer.addChild(this.triesText);

    this.bonusText = new Text('x2', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 22,
      fontWeight: '900',
      fill: 0xfff176,
      stroke: '#5a2a0a',
      strokeThickness: 3,
    });
    this.bonusText.anchor.set(0.5, 0.5);
    this.bonusText.visible = false;
    this.playContainer.addChild(this.bonusText);

    this.actionButton = this._createButton('Crack Egg', () => {
      if (this.isLocked) return;
      this._handleCrack();
    });
    this.playContainer.addChild(this.actionButton);

    this.buyButton = this._createButton('Buy Egg', () => {
      if (this.isLocked) return;
      this._handleBuy();
    }, { width: 240, height: 64, color: 0x6d4c41 });
    this.playContainer.addChild(this.buyButton);

    this.cashoutButton = this._createButton('Cashout', () => {
      if (this.isLocked) return;
      this._handleCashout();
    }, { width: 180, height: 54, color: 0x1b5e20 });
    this.playContainer.addChild(this.cashoutButton);

    this.backButton = this._createButton('🏠', () => {
      if (this.isLocked) return;
      this._goHome();
    }, { width: 64, height: 46, color: 0x4e342e, fontSize: 22 });
    this.backButton.visible = false;
    this.playContainer.addChild(this.backButton);

    this._toggleMode('home');
    this._refreshStatusBadge();
    this._drawEgg(renderer.width / 2, renderer.height * 0.4);
    this._loadEggSprites();
  }

  _setupHomeDom() {
    if (!this.containerEl) return;
    const computed = window.getComputedStyle(this.containerEl);
    if (computed.position === 'static' || !computed.position) {
      this.containerEl.style.position = 'relative';
    }
    const dom = document.createElement('div');
    dom.id = 'home-shell';
    Object.assign(dom.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      padding: '96px 16px 48px',
      gap: '16px',
      overflowY: 'auto',
      height: '100%',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      overscrollBehavior: 'contain',
      pointerEvents: 'auto',
      color: '#ffe082',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      width: '100%',
      maxWidth: '1080px',
      margin: '0 auto',
    });
    this.containerEl.appendChild(dom);
    this.homeDomRoot = dom;

    if (!document.getElementById('home-shell-style')) {
      const style = document.createElement('style');
      style.id = 'home-shell-style';
      style.textContent = '#home-shell::-webkit-scrollbar { width: 0; height: 0; }';
      document.head.appendChild(style);
    }
  }

  _setupControlsBar() {
    if (!this.containerEl) return;
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute',
      top: '12px',
      left: '12px',
      right: '12px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '6px',
      zIndex: '10',
    });

    const makeBtn = (label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        padding: '8px 12px',
        background: 'rgba(45,13,13,0.9)',
        color: '#ffd54f',
        border: '2px solid #ffd54f',
        borderRadius: '10px',
        fontWeight: '700',
        cursor: 'pointer',
      });
      return btn;
    };

    const leftSlot = document.createElement('div');
    Object.assign(leftSlot.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    const logo = document.createElement('div');
    logo.textContent = 'Golden Eggs';
    Object.assign(logo.style, {
      fontSize: '22px',
      fontWeight: '900',
      color: '#ffd54f',
      textTransform: 'uppercase',
      letterSpacing: '1px',
      textAlign: 'center',
    });

    const buttonWrap = document.createElement('div');
    Object.assign(buttonWrap.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
      position: 'relative',
    });

    const infoBtn = makeBtn('Info');
    infoBtn.onclick = () => this._showInfoModal();

    const rewardsBtn = makeBtn('History');
    rewardsBtn.onclick = () => this._showHistoryModal();

    const soundBtn = makeBtn('Sound');
    soundBtn.onclick = () => this._toggleSoundPanel();

    buttonWrap.appendChild(infoBtn);
    buttonWrap.appendChild(rewardsBtn);
    buttonWrap.appendChild(soundBtn);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'absolute',
      top: '44px',
      right: '0',
      background: 'rgba(28,14,14,0.95)',
      border: '2px solid #ffd54f',
      borderRadius: '10px',
      padding: '10px 12px',
      width: '220px',
      color: '#ffe082',
      display: 'none',
      boxShadow: '0 10px 20px rgba(0,0,0,0.35)',
      zIndex: '11',
    });

    const label = document.createElement('div');
    label.textContent = 'Volume';
    label.style.marginBottom = '6px';
    panel.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(this.volume * 100));
    slider.style.width = '100%';
    slider.oninput = (e) => {
      const v = Math.max(0, Math.min(100, Number(e.target.value || 0))) / 100;
      this._startMusic();
      this._setVolume(v);
    };
    panel.appendChild(slider);

    const muteToggle = document.createElement('button');
    muteToggle.textContent = this.isMuted ? 'Unmute' : 'Mute';
    Object.assign(muteToggle.style, {
      marginTop: '8px',
      padding: '8px',
      width: '100%',
      background: '#5d4037',
      color: '#ffe082',
      border: 'none',
      borderRadius: '8px',
      fontWeight: '700',
      cursor: 'pointer',
    });
    muteToggle.onclick = () => {
      this._startMusic();
      this.isMuted = !this.isMuted;
      muteToggle.textContent = this.isMuted ? 'Unmute' : 'Mute';
      this._applyVolumeToAudio();
    };
    panel.appendChild(muteToggle);

    buttonWrap.appendChild(panel);

    const topRow = document.createElement('div');
    Object.assign(topRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    });

    topRow.appendChild(leftSlot);
    topRow.appendChild(buttonWrap);
    bar.appendChild(topRow);
    bar.appendChild(logo);
    this.containerEl.appendChild(bar);
    this.soundPanel = panel;
  }

  _setupEggTabs() {
    if (!this.containerEl) return;
    if (this.tabsRoot) return;

    const tabs = document.createElement('div');
    Object.assign(tabs.style, {
      position: 'absolute',
      top: '92px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '10px',
      padding: '6px',
      background: 'rgba(28,14,14,0.85)',
      border: '1px solid rgba(255, 213, 79, 0.4)',
      borderRadius: '14px',
      zIndex: '9',
    });

    const makeTab = (id, label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        padding: '8px 14px',
        background: 'rgba(45,13,13,0.9)',
        color: '#ffd54f',
        border: '2px solid transparent',
        borderRadius: '12px',
        fontWeight: '800',
        cursor: 'pointer',
        minWidth: '140px',
      });
      btn.onclick = () => this._selectEggTab(id);
      return btn;
    };

    const goldTab = makeTab('gold', 'Gold - RM100');
    const premiumTab = makeTab('premium', 'Premium - RM1000');

    tabs.appendChild(goldTab);
    tabs.appendChild(premiumTab);

    this.containerEl.appendChild(tabs);
    this.tabsRoot = tabs;
    this.tabButtons = { gold: goldTab, premium: premiumTab };
    this._refreshEggTabs();
  }

  _setupStoredBar() {
    if (!this.containerEl) return;
    if (this.storedBarRoot) return;

    const bar = document.createElement('div');
    bar.id = 'stored-bar';
    Object.assign(bar.style, {
      position: 'absolute',
      top: '150px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      gap: '12px',
      padding: '10px 12px',
      background: 'rgba(20,8,8,0.85)',
      border: '1px solid rgba(255, 213, 79, 0.35)',
      borderRadius: '14px',
      zIndex: '9',
      width: 'fit-content',
    });

    const slots = [];
    for (let i = 0; i < 3; i += 1) {
      const slot = document.createElement('div');
      Object.assign(slot.style, {
        width: '150px',
        minHeight: '54px',
        borderRadius: '12px',
        border: '1px dashed rgba(255, 213, 79, 0.4)',
        color: '#ffe082',
        fontWeight: '700',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 8px',
        textAlign: 'center',
        background: 'rgba(45,13,13,0.7)',
      });
      bar.appendChild(slot);
      slots.push(slot);
    }

    this.containerEl.appendChild(bar);
    this.storedBarRoot = bar;
    this.storedSlots = slots;
    this._updateStoredBarLayout();
    this._renderStoredBar();
  }

  _renderStoredBar() {
    if (!this.storedSlots) return;
    const eggs = this.storedEggs.slice(0, 3);
    this.storedSlots.forEach((slot, index) => {
      const egg = eggs[index];
      slot.innerHTML = '';
      if (!egg) {
        const empty = document.createElement('div');
        empty.textContent = 'Empty';
        slot.appendChild(empty);
        slot.style.borderStyle = 'dashed';
        slot.style.cursor = 'default';
        slot.onclick = null;
        return;
      }
      const label = document.createElement('div');
      const hasWon = (egg.tries ?? 0) > 0 && typeof egg.lastWinAmount === 'number' && egg.lastWinAmount > 0;
      label.textContent = hasWon
        ? `${egg.label ?? egg.id ?? 'Egg'} RM${egg.lastWinAmount}`
        : `${egg.label ?? egg.id ?? 'Egg'}`;
      label.style.marginBottom = '6px';

      const isActive = egg.uid === this.activeEggUid;
      const isMaxed = egg.isMaxed === true;
      slot.style.background = isActive ? 'rgba(90,40,10,0.95)' : 'rgba(45,13,13,0.7)';
      slot.style.borderColor = isActive ? '#ffd54f' : 'rgba(255, 213, 79, 0.4)';

      slot.appendChild(label);
      if (egg.uid !== this.activeEggUid && !isMaxed) {
        const btn = document.createElement('button');
        btn.textContent = 'Retrieve';
        Object.assign(btn.style, {
          padding: '4px 8px',
          background: '#5d4037',
          color: '#ffe082',
          border: 'none',
          borderRadius: '8px',
          fontWeight: '700',
          fontSize: '11px',
          cursor: 'pointer',
        });
        btn.onclick = () => {
          if (this.isLocked) return;
          this._retrieveStoredEgg(egg);
        };
        slot.appendChild(btn);
      }
      slot.style.borderStyle = 'solid';
      slot.style.cursor = 'default';
      slot.onclick = null;
    });
  }

  _refreshEggTabs() {
    if (!this.tabButtons) return;
    const hasActiveEgg = Boolean(this.activeEggUid);
    Object.entries(this.tabButtons).forEach(([id, btn]) => {
      const active = !hasActiveEgg && id === this.activeTabId;
      btn.style.borderColor = active ? '#ffd54f' : 'transparent';
      btn.style.background = active ? 'rgba(90,40,10,0.95)' : 'rgba(45,13,13,0.9)';
      btn.style.color = active ? '#fff0b3' : '#ffd54f';
    });
  }

  _updateTabsVisibility() {
    if (!this.tabsRoot) return;
    const shouldHide = this.isLocked;
    this.tabsRoot.style.display = this.mode === 'play' && !shouldHide ? 'flex' : 'none';
  }

  _setupModalShell() {
    if (!this.containerEl) return;
    if (this.modalRoot) return;

    const overlay = document.createElement('div');
    overlay.id = 'game-modal';
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10, 5, 5, 0.72)',
      zIndex: '20',
      padding: '16px',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: 'linear-gradient(160deg, rgba(45,13,13,0.98), rgba(20,8,8,0.98))',
      border: '2px solid #ffd54f',
      borderRadius: '16px',
      padding: '20px 22px',
      maxWidth: '520px',
      width: '100%',
      color: '#ffe082',
      boxShadow: '0 18px 36px rgba(0,0,0,0.45)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontWeight: '800',
      fontSize: '20px',
      color: '#ffd54f',
    });

    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
    });

    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    Object.assign(closeX.style, {
      width: '30px',
      height: '30px',
      background: 'linear-gradient(135deg, rgba(93, 64, 55, 0.9), rgba(55, 28, 24, 0.9))',
      color: '#ffe082',
      border: '1px solid rgba(255, 213, 79, 0.35)',
      borderRadius: '999px',
      fontWeight: '800',
      fontSize: '14px',
      lineHeight: '1',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
    });
    closeX.onclick = () => this._closeModal();

    headerRow.appendChild(title);
    headerRow.appendChild(closeX);

    const body = document.createElement('div');
    Object.assign(body.style, {
      fontSize: '15px',
      lineHeight: '1.5',
      color: '#ffeeb7',
      whiteSpace: 'pre-wrap',
    });

    panel.appendChild(headerRow);
    panel.appendChild(body);
    overlay.appendChild(panel);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this._closeModal();
      }
    });

    this.containerEl.appendChild(overlay);
    this.modalRoot = overlay;
    this.modalTitle = title;
    this.modalBody = body;
    this.modalCloseX = closeX;
  }

  _updateStoredBarLayout() {
    if (!this.storedBarRoot || !this.storedSlots) return;
    const viewportWidth = window.innerWidth || 0;
    const isTablet = viewportWidth > 520 && viewportWidth <= 920;
    const isMobile = viewportWidth <= 520;
    const slotWidth = isMobile ? 100 : isTablet ? 120 : 150;
    const slotMinHeight = isMobile ? 46 : isTablet ? 50 : 54;
    const fontSize = isMobile ? 11 : isTablet ? 12 : 13;
    const padding = isMobile ? '8px 10px' : isTablet ? '9px 11px' : '10px 12px';
    const gap = isMobile ? '8px' : isTablet ? '10px' : '12px';
    this.storedBarRoot.style.padding = padding;
    this.storedBarRoot.style.gap = gap;
    const top = isMobile ? '170px' : isTablet ? '170px' : '150px';
    this.storedBarRoot.style.maxWidth = 'none';
    this.storedBarRoot.style.top = top;

    this.storedSlots.forEach((slot) => {
      slot.style.width = `${slotWidth}px`;
      slot.style.minHeight = `${slotMinHeight}px`;
      slot.style.fontSize = `${fontSize}px`;
    });
  }

  _showModal(title, message) {
    if (!this.modalRoot) return;
    this.modalTitle.textContent = title;
    if (this.modalCloseX) {
      this.modalCloseX.style.display = 'inline-flex';
    }
    this.modalBody.innerHTML = '';
    this.modalBody.style.display = 'block';
    this.modalBody.style.gap = '0';
    this.modalBody.style.whiteSpace = 'pre-wrap';
    this.modalBody.textContent = message;
    this.modalRoot.style.display = 'flex';
  }

  _closeModal() {
    if (this.modalRoot) {
      this.modalRoot.style.display = 'none';
    }
  }

  // endregion setup -------------------------------------------------------------

  setConfig(config = {}) {
    this._initTabEggs();
    this.currency = config.currency || this.currency || '';
    this.maxStored = typeof config.maxStored === 'number' ? config.maxStored : 3;
    this._renderHomeDom();
    this._renderPlay();
  }

  _initTabEggs() {
    this.boughtEggs = [];
    this.activeTabId = 'gold';
    this.activeEggUid = null;
    this.activeSource = 'bought';
    this._refreshEggTabs();
  }

  updateBalance(amount) {
    // Balance fetched but not displayed in UI.
    this.balance = amount ?? this.balance;
  }

  showLoading(message) {
    this._setStatus('', 0xffeb3b, 0xfff7cf);
    this.lockUI(true);
  }

  showError(message) {
    this._setStatus(message, 0xff8a80, 0xffe0e0);
    this._showToast(message, 'error');
    this.lockUI(false);
  }

  ready() {
    this.lockUI(false);
    this._toggleMode('play');
    this._closeSoundPanel();
  }

  async showResult(result = {}) {
    const { result: outcome, winAmount = 0, balance, eggId, bonus } = result;
    if (balance !== undefined) {
      this.updateBalance(balance);
    }

    const egg = eggId ? this._findEggByUid(eggId, this.activeSource) : this._getActiveEgg();

    if (outcome === 'stored') {
      this.lastBonus = false;
      await this._playStoreAnimation();
      this._moveActiveToStored();
      this._showToast('Your egg has been stored successfully.', 'success');
      this._selectEggTab(this.activeTabId || 'gold');
      this.lockUI(false);
      return;
    }

    if (outcome === 'cashout') {
      this.lastBonus = false;
      this._removeActiveEgg();
      const amount = egg?.lastWinAmount ?? 0;
      if (egg) {
        this.cashoutHistory.unshift({
          label: egg.label ?? egg.id ?? 'Egg',
          amount,
          time: new Date(),
        });
        if (this.cashoutHistory.length > 20) {
          this.cashoutHistory.length = 20;
        }
      }
      this._recordHistory(2, egg, { winAmount: amount });
      this._showToast(`Cashed out RM${amount}.`, 'success');
      this._toggleMode('play');
      this._renderPlay();
      this.lockUI(false);
      return;
    }

    if (outcome === 'win' || outcome === 'lose') {
      this.isCracked = true;
      this.lastBonus = outcome === 'win' ? Boolean(bonus) : false;
      this._drawCrackOverlay();
      await this._playBreakAnimation();

      if (egg) {
        egg.tries = Math.min(this.maxCracks, (egg.tries ?? 0) + 1);
      }

      if (outcome === 'win') {
        if (egg) {
          const currentBet = typeof egg.bet === 'number' ? egg.bet : 0;
          const doubled = currentBet > 0 ? currentBet * 2 : winAmount || currentBet;
          egg.lastWinAmount = winAmount ?? 0;
          if (doubled > 0) {
            egg.bet = doubled;
          }
        }
        this.lastResultText = `Won RM${winAmount}`;
        this._recordHistory(1, egg, { winAmount });
      // this._setStatus(`Fortune found! +${winAmount}`, 0x8cff66, 0xe4ffd8);
      // this._flashEgg(0x9ccc65);
      this._showToast(`Fortune found! +RM${winAmount}`, 'success');
    } else {
      this._removeActiveEgg();
      this.lastBonus = false;
      this.lastResultText = 'Try again later';
        this._recordHistory(0, egg);
        this._setStatus('', 0xffccbc, 0x2d0d0d);
        // this._flashEgg(0xff7043);
        this._showToast('Try again later', 'error');
      }
      this._showResultModalAndReset(outcome === 'win', winAmount, egg);
    } else {
      this.lastBonus = false;
      this._setStatus('Action completed.', 0xffeb3b, 0xfff7cf);
    }

    this._updateActionButtons();
    this._renderHomeDom();
    this._renderPlay();
    this.lockUI(false);
  }

  // region actions --------------------------------------------------------------
  async _handleCrack() {
    const egg = this._getActiveEgg();
    if (!egg || !this.onAction) {
      this._showToast('Select an egg first.', 'info');
      return;
    }
    const tries = egg.tries ?? 0;
    if (tries >= this.maxCracks) {
      this._showToast(`Max level reached (${this.maxCracks}/${this.maxCracks}).`, 'info');
      return;
    }
    egg.lastCrackLevel = this._getEggLevel(egg);
    this.lockUI(true);
    await this._knockAnim();
    this.onAction({
      action: 'crack',
      betAmount: egg.bet,
      eggId: egg.uid,
      tryIndex: egg.tries ?? 0,
    });
  }

  _handleCashout() {
    const egg = this._getActiveEgg();
    if (!egg) {
      this._showToast('Select an egg first.', 'info');
      return;
    }
    this.lockUI(true);
    this.onAction?.({
      action: 'cashout',
      betAmount: egg.bet,
      eggId: egg.uid,
      tryIndex: egg.tries ?? 0,
    });
  }

  _handleBuy() {
    if (this.activeEggUid) return;
    if (this.storedEggs.length >= this.maxStored) {
      this._showToast(`Storage is full (${this.maxStored}/${this.maxStored}).`, 'error');
      return;
    }
    const template = this._getSelectedEggTemplate();
    const newEgg = this._createEggInstance(template);
    this.boughtEggs.push(newEgg);
    this.storedEggs.push(newEgg);
    this._renderStoredBar();
    this._enterPlay(newEgg, 'stored');
  }

  _showResultModalAndReset(didWin, winAmount, egg) {
    const amountText = typeof winAmount === 'number' ? winAmount : 0;
    const title = didWin ? 'Congratulations' : 'Out Of Luck';
    const message = didWin
      ? `You have won RM${amountText}.`
      : 'Try again next time!';
    this._showModal(title, message);
    if (this.modalCloseX) {
      this.modalCloseX.style.display = 'none';
    }
    if (this.modalTitle) {
      this.modalTitle.style.textAlign = 'center';
      this.modalTitle.style.width = '100%';
    }

    if (didWin && egg && !this.storedEggs.some((item) => item.uid === egg.uid)) {
      this.storedEggs.push(egg);
      this._renderStoredBar();
    }

    if (this._resultTimeout) {
      clearTimeout(this._resultTimeout);
      this._resultTimeout = null;
    }
    if (this.modalBody) {
      this.modalBody.innerHTML = '';
      this.modalBody.style.display = 'flex';
      this.modalBody.style.flexDirection = 'column';
      this.modalBody.style.gap = '12px';
      this.modalBody.style.whiteSpace = 'normal';

      const text = document.createElement('div');
      text.textContent = message;
      if (didWin || !didWin) {
        Object.assign(text.style, {
          textAlign: 'center',
          fontSize: '18px',
          fontWeight: '700',
        });
      }
      this.modalBody.appendChild(text);

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      Object.assign(confirmBtn.style, {
        alignSelf: 'center',
        padding: '8px 14px',
        background: '#5d4037',
        color: '#ffe082',
        border: 'none',
        borderRadius: '10px',
        fontWeight: '700',
        cursor: 'pointer',
      });
      confirmBtn.onclick = () => {
        this._closeModal();
        this.isCracked = false;
        this.lastBonus = false;
        if (!didWin) {
          this.activeEggUid = null;
        }
        if (didWin && egg && (egg.tries ?? 0) >= this.maxCracks) {
          egg.isMaxed = true;
          this.activeEggUid = null;
          this._renderStoredBar();
        }
        this._renderPlay();
      };
      this.modalBody.appendChild(confirmBtn);
    }
  }

  _retrieveStoredEgg(egg) {
    if (!egg) return;
    const current = this._getActiveEgg();
    if (current && current.uid === egg.uid) {
      return;
    }
    this._enterPlay(egg, 'stored');
  }

  async _purchaseEgg(template) {
    // Purchases happen outside; this path is unused.
    return template;
  }

  _getSelectedEggTemplate() {
    if (this.activeTabId === 'premium') {
      return { id: 'premium', label: 'Premium Egg', bet: 1000 };
    }
    return { id: 'gold', label: 'Gold Egg', bet: 100 };
  }

  _selectEggTab(tabId) {
    const current = this._getActiveEgg();
    if (current) {
      const alreadyStored = this.storedEggs.some((item) => item.uid === current.uid);
      if (!alreadyStored && this.storedEggs.length >= this.maxStored) {
        this._showToast(`Storage is full (${this.maxStored}/${this.maxStored}).`, 'error');
        return;
      }
      if (!alreadyStored) {
        this.storedEggs.push(current);
      }
      this.activeEggUid = null;
      this.isCracked = false;
      this.lastResultText = '';
      this._renderStoredBar();
    }
    this.activeTabId = tabId;
    this._refreshEggTabs();
    this._updateBuyButtonLabel();
    this._renderPlay();
  }

  _enterPlay(egg, source = 'bought') {
    if (!egg) return;
    this.activeEggUid = egg.uid;
    this.activeSource = source;
    this.isCracked = false;
    this._drawCrackOverlay();
    this._toggleMode('play');
    this._renderPlay();
  }

  _goHome() {
    this.activeEggUid = null;
    this.isCracked = false;
    this._drawCrackOverlay();
    this._toggleMode('home');
    this._renderHomeDom();
    this._closeSoundPanel();
  }
  // endregion actions -----------------------------------------------------------

  // region rendering ------------------------------------------------------------
  _renderHomeDom() {
    if (!this.homeDomRoot) return;
    this.homeDomRoot.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = 'Purchased Eggs';
    Object.assign(title.style, {
      margin: '0',
      color: '#ffd54f',
      textAlign: 'left',
      width: '100%',
      alignSelf: 'flex-start',
    });
    this.homeDomRoot.appendChild(title);

    this.homeDomRoot.appendChild(
      this._buildGroupedGrid(
        this.boughtEggs,
        (group) => this._enterPlay(this._pickEggFromGroup(this.boughtEggs, group), 'bought'),
        { emptyText: 'No purchased eggs yet.', horizontalOnMobile: true },
      ),
    );

    const storedTitle = document.createElement('h3');
    storedTitle.textContent = `Stored eggs (${this.storedEggs.length}/${this.maxStored})`;
    Object.assign(storedTitle.style, {
      margin: '24px 0 0',
      color: '#ffd54f',
      textAlign: 'left',
      width: '100%',
      alignSelf: 'flex-start',
    });
    this.homeDomRoot.appendChild(storedTitle);

    this.homeDomRoot.appendChild(
      this._buildGroupedGrid(
        this.storedEggs,
        (group) => this._enterPlay(this._pickEggFromGroup(this.storedEggs, group), 'stored'),
        {
          emptyText: 'You can store up to 3 eggs for later.',
          columns: 'repeat(3, minmax(220px, 1fr))',
          horizontalOnMobile: true,
        },
      ),
    );

    const reward = document.createElement('div');
    reward.textContent = this.lastResultText ? `Last reward: ${this.lastResultText}` : 'Crack an egg to see rewards here.';
    reward.style.marginTop = '16px';
    reward.style.color = '#ffe082';
    this.homeDomRoot.appendChild(reward);
  }

  _renderPlay() {
    const width = this.app?.renderer?.width || 800;
    const height = this.app?.renderer?.height || 600;
    const egg = this._getActiveEgg();
    const hasEgg = Boolean(egg);
    const displayAmount = egg && typeof egg.lastWinAmount === 'number' && egg.lastWinAmount > 0
      ? egg.lastWinAmount
      : null;
    const pricePart =
      egg && typeof displayAmount === 'number' && displayAmount > 0 ? ` RM${displayAmount}` : '';
    const label = egg ? `${egg.label ?? egg.id ?? 'Egg'}${pricePart}` : '';
    this.eggLabel.text = label;
    this.eggLabel.position.set(width / 2, height * 0.8);

    this.triesText.text = '';

    if (!hasEgg) {
      this.isCracked = false;
      this.lastBonus = false;
    }
    if (hasEgg) {
      this._ensureEggSprites(egg);
    }
    this._drawEgg(width / 2, height * 0.55);
    this._drawCrackOverlay();
    this.egg.visible = hasEgg;
    this.eggLabel.visible = hasEgg;
    this.crackOverlay.visible = hasEgg && this.isCracked;
    if (this.eggSpriteContainer) {
      this.eggSpriteContainer.visible = hasEgg;
    }
    if (this.eggCenter && this.bonusText) {
      this.bonusText.position.set(
        this.eggCenter.x + this.eggCenter.width * 0.5,
        this.eggCenter.y - this.eggCenter.height * 0.46,
      );
      this.bonusText.visible = hasEgg && this.lastBonus;
      if (this.lastBonus && hasEgg) {
        this._startBonusBounce();
      } else {
        this._stopBonusBounce();
      }
    }
    if (this.buyButton) {
      this._updateBuyButtonLabel();
      this.buyButton.visible = !hasEgg;
      this.buyButton.position.set(
        width / 2 - this.buyButton.width / 2,
        height / 2 - this.buyButton.height / 2,
      );
    }
    this._updateActionButtons();
    this._updateTabsVisibility();
    this._renderStoredBar();
    this._positionActionButtons(width, height);
  }

  _updateBuyButtonLabel() {
    if (!this.buyButton || !this.buyButton._labelText) return;
    const template = this._getSelectedEggTemplate();
    const amount = template.bet ?? 0;
    this.buyButton._labelText.text = `Buy ${template.label} RM${amount}`;
    this.buyButton._labelText.position.set(this.buyButton.width / 2, this.buyButton.height / 2);
  }

  _buildGroupedGrid(eggs, onCrack, { emptyText, columns, horizontalOnMobile } = {}) {
    const grid = document.createElement('div');
    const useHorizontal = horizontalOnMobile && (window.innerWidth || 0) < 720;
    Object.assign(grid.style, {
      display: useHorizontal ? 'flex' : 'grid',
      gridTemplateColumns: useHorizontal ? '' : (columns || 'repeat(auto-fit, minmax(220px, 1fr))'),
      gap: '12px',
      width: '100%',
      maxWidth: '960px',
      overflowX: useHorizontal ? 'auto' : 'visible',
      paddingBottom: useHorizontal ? '6px' : '0',
      scrollSnapType: useHorizontal ? 'x mandatory' : 'none',
    });
    if (useHorizontal) {
      grid.style.webkitOverflowScrolling = 'touch';
    }

    if (!eggs.length) {
      const empty = document.createElement('div');
      empty.textContent = emptyText || 'No eggs available.';
      empty.style.color = '#ffcdd2';
      grid.appendChild(empty);
      return grid;
    }

    const grouped = this._groupEggs(eggs);
    grouped.forEach((group) => {
      const card = this._createEggCardDom(group, { onCrack: () => onCrack(group) });
      if (useHorizontal) {
        card.style.minWidth = '220px';
        card.style.scrollSnapAlign = 'start';
      }
      grid.appendChild(card);
    });
    return grid;
  }

  _createEggCardDom(group, { onCrack }) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(59,27,27,0.95)',
      borderRadius: '14px',
      padding: '14px',
      color: '#fff1c1',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      boxShadow: '0 8px 16px rgba(0,0,0,0.25)',
      alignItems: 'center',
    });

    const title = document.createElement('div');
    title.textContent = group.count > 1
      ? `${group.label ?? group.id ?? 'Egg'} x${group.count}`
      : group.label ?? group.id ?? 'Egg';
    Object.assign(title.style, {
      fontWeight: '800',
      fontSize: '16px',
      textAlign: 'center',
      width: '100%',
    });
    card.appendChild(title);

    if (group.bet !== undefined) {
      const price = document.createElement('div');
      price.textContent = `RM${group.bet}`;
      Object.assign(price.style, {
        color: '#ffd54f',
        fontWeight: '700',
        fontSize: '14px',
      });
      card.appendChild(price);
    }

    const eggVisual = document.createElement('div');
    Object.assign(eggVisual.style, {
      width: '72px',
      height: '96px',
      borderRadius: '50% / 55%',
      background: 'linear-gradient(180deg, #ffe082 0%, #d4af37 80%)',
      boxShadow: '0 6px 12px rgba(0,0,0,0.25), inset 0 2px 6px rgba(255,255,255,0.35)',
      margin: '0 auto 4px',
    });
    card.appendChild(eggVisual);

    const crackBtn = document.createElement('button');
    crackBtn.textContent = 'Crack';
    Object.assign(crackBtn.style, {
      marginTop: '6px',
      padding: '10px 12px',
      background: '#d32f2f',
      color: '#fff',
      border: 'none',
      borderRadius: '10px',
      fontWeight: '700',
      cursor: 'pointer',
    });
    crackBtn.onclick = onCrack;
    card.appendChild(crackBtn);

    return card;
  }

  _groupEggs(eggs) {
    const map = new Map();
    eggs.forEach((egg) => {
      const baseId = egg.id || egg.label || 'egg';
      const betKey = typeof egg.bet === 'number' ? egg.bet : 'na';
      const key = `${baseId}:${betKey}`;
      if (!map.has(key)) {
        map.set(key, { ...egg, id: baseId, groupKey: key, count: 0 });
      }
      map.get(key).count += 1;
    });
    return Array.from(map.values());
  }

  _pickEggFromGroup(list, group) {
    if (!group) return list[0] || null;
    const bet = typeof group.bet === 'number' ? group.bet : undefined;
    return list.find((egg) => egg.id === group.id && egg.bet === bet) || list[0] || null;
  }

  _toggleSoundPanel() {
    if (!this.soundPanel) return;
    this.soundPanel.style.display = this.soundPanel.style.display === 'none' ? 'block' : 'none';
    if (this.soundPanel.style.display === 'block') {
      this._startMusic();
    }
  }

  _closeSoundPanel() {
    if (this.soundPanel) this.soundPanel.style.display = 'none';
  }

  _setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.volume === 0) {
      this.isMuted = true;
    } else {
      this.isMuted = false;
    }
    this._applyVolumeToAudio();
  }

  _applyVolumeToAudio() {
    if (!this.gainNode) return;
    const target = this.isMuted ? 0 : this.volume * 0.15;
    this.gainNode.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.05);
  }

  _ensureAudio() {
    if (this.audioCtx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.audioCtx = new AudioCtx();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.isMuted ? 0 : this.volume * 0.15;
    this.gainNode.connect(this.audioCtx.destination);
  }

  _startMusic() {
    this._ensureAudio();
    if (!this.audioCtx || this.isMusicOn) return;
    const osc = this.audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 220;
    osc.detune.value = 4;
    osc.connect(this.gainNode);
    osc.start();
    this.oscNode = osc;
    this.isMusicOn = true;
    this._applyVolumeToAudio();
  }

  _stopMusic() {
    if (this.oscNode) {
      try {
        this.oscNode.stop();
      } catch (err) {
        // ignore
      }
      this.oscNode.disconnect();
    }
    this.oscNode = null;
    this.isMusicOn = false;
  }

  _showInfoModal() {
    this._showModal(
      'How to play',
      'Crack your purchased eggs, store up to 3, and cash out after a winning crack.',
    );
  }

  _showHistoryModal() {
    if (!this.history.length) {
      this._showModal('History', 'No game history yet.');
      return;
    }
    this._showModal('History', '');
    this.modalBody.style.display = 'flex';
    this.modalBody.style.flexDirection = 'column';
    this.modalBody.style.gap = '10px';
    this.modalBody.style.maxHeight = '240px';
    this.modalBody.style.overflowY = 'auto';
    this.modalBody.style.paddingRight = '6px';
    this.modalBody.style.scrollbarWidth = 'thin';
    this.modalBody.style.scrollbarColor = 'rgba(255, 213, 79, 0.6) rgba(20, 8, 8, 0.4)';
    this.modalBody.classList.add('history-body');

    if (!document.getElementById('history-scrollbar-style')) {
      const style = document.createElement('style');
      style.id = 'history-scrollbar-style';
      style.textContent = `
        #game-modal .history-body::-webkit-scrollbar { width: 6px; }
        #game-modal .history-body::-webkit-scrollbar-track { background: rgba(20, 8, 8, 0.4); border-radius: 6px; }
        #game-modal .history-body::-webkit-scrollbar-thumb { background: rgba(255, 213, 79, 0.6); border-radius: 6px; }
        #game-modal .history-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 213, 79, 0.8); }
      `;
      document.head.appendChild(style);
    }

    const statusLabel = (value) => {
      if (value === 1) return 'Success';
      if (value === 2) return 'Redeemed';
      return 'Failed';
    };
    const statusStyle = (value) => {
      if (value === 1) return { bg: 'rgba(102, 187, 106, 0.2)', color: '#b9f6ca' };
      if (value === 2) return { bg: 'rgba(255, 213, 79, 0.2)', color: '#ffe082' };
      return { bg: 'rgba(239, 83, 80, 0.2)', color: '#ffccbc' };
    };

    this.history.forEach((entry, index) => {
      const when = entry.time instanceof Date
        ? entry.time.toLocaleString()
        : String(entry.time || '');
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        borderRadius: '12px',
        background: 'rgba(30, 12, 12, 0.7)',
        border: '1px solid rgba(255, 213, 79, 0.25)',
      });

      const left = document.createElement('div');
      Object.assign(left.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontWeight: '700',
        color: '#ffe082',
        flexWrap: 'wrap',
      });

      const title = document.createElement('div');
      title.textContent = `${index + 1}. ${entry.eggType ?? 'Egg'}`;

      const status = document.createElement('div');
      const statusToken = statusStyle(entry.status);
      status.textContent = statusLabel(entry.status);
      Object.assign(status.style, {
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        background: statusToken.bg,
        color: statusToken.color,
        border: '1px solid rgba(255, 213, 79, 0.2)',
      });

      left.appendChild(title);
      left.appendChild(status);

      const right = document.createElement('div');
      right.textContent = entry.winAmount ? `RM${entry.winAmount}` : '-';
      Object.assign(right.style, {
        fontWeight: '800',
        color: '#ffd54f',
        textAlign: 'right',
      });

      const time = document.createElement('div');
      time.textContent = when;
      Object.assign(time.style, {
        gridColumn: '1 / -1',
        fontSize: '12px',
        color: '#d7c6a0',
      });

      row.appendChild(left);
      row.appendChild(right);
      row.appendChild(time);
      this.modalBody.appendChild(row);
    });
  }
  // endregion rendering ---------------------------------------------------------

  // region utils / visuals ------------------------------------------------------
  _createButton(label, onPress, options = {}) {
    const width = options.width ?? 220;
    const height = options.height ?? 64;
    const color = options.color ?? 0xd32f2f;
    const fontSize = options.fontSize ?? 18;
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
      fontSize,
      fontWeight: '700',
      fill: 0xffffff,
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2);

    container.addChild(bg, glow, text);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', onPress);
    container._labelText = text;

    container.width = width;
    container.height = height;
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
    const eggWidth = 400;
    const eggHeight = 400;

    this.eggCenter = { x: centerX, y: centerY, width: eggWidth, height: eggHeight };

    this.egg.clear();
    if (!this.fullEggSprite || !this.brokenEggSprite) {
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
    this.egg.visible = !this.fullEggSprite || !this.brokenEggSprite;
    this._syncEggSprites();

    this._drawCrackOverlay();
  }

  _drawCrackOverlay() {
    this.crackOverlay.clear();
    if (!this.isCracked || !this.eggCenter) return;
  }

  _getEggLevel(egg) {
    const tries = egg?.tries ?? 0;
    return Math.min(tries + 1, this.maxCracks);
  }

  _getEggLevelForDisplay(egg) {
    if (this.isCracked && egg?.lastCrackLevel) {
      return egg.lastCrackLevel;
    }
    return this._getEggLevel(egg);
  }

  _getEggSpriteUrls(egg, level) {
    const type = egg?.id === 'premium' ? 'premium' : 'gold';
    const safeLevel = Math.max(1, Math.min(level || 1, this.maxCracks));
    return {
      fullUrl: `/assets/${type}_egg${safeLevel}.png`,
      brokenUrl: `/assets/${type}_egg_broken${safeLevel}.png`,
      key: `${type}-${safeLevel}`,
    };
  }

  async _loadEggTextures(fullUrl, brokenUrl) {
    const textures = await Assets.load([fullUrl, brokenUrl]);
    const fullTex = Array.isArray(textures) ? textures[0] : textures[fullUrl];
    const brokenTex = Array.isArray(textures) ? textures[1] : textures[brokenUrl];
    if (!fullTex || !brokenTex) {
      throw new Error('Egg textures failed to load.');
    }
    return { fullTex, brokenTex };
  }

  _applyEggTextures(fullTex, brokenTex) {
    if (!this.fullEggSprite) {
      this.fullEggSprite = new Sprite(fullTex);
      this.fullEggSprite.anchor.set(0.5);
      this.eggSpriteContainer.addChild(this.fullEggSprite);
    } else {
      this.fullEggSprite.texture = fullTex;
    }

    if (!this.brokenEggSprite) {
      this.brokenEggSprite = new Sprite(brokenTex);
      this.brokenEggSprite.anchor.set(0.5);
      this.eggSpriteContainer.addChild(this.brokenEggSprite);
    } else {
      this.brokenEggSprite.texture = brokenTex;
    }

    this._syncEggSprites();
  }

  async _ensureEggSprites(egg) {
    if (!egg) return;
    const level = this._getEggLevelForDisplay(egg);
    const { fullUrl, brokenUrl, key } = this._getEggSpriteUrls(egg, level);
    if (this._eggSpriteKey === key && this.fullEggSprite && this.brokenEggSprite) {
      this._syncEggSprites();
      return;
    }
    try {
      const { fullTex, brokenTex } = await this._loadEggTextures(fullUrl, brokenUrl);
      this._applyEggTextures(fullTex, brokenTex);
      this._eggSpriteKey = key;
    } catch (err) {
      try {
        const { fullTex, brokenTex } = await this._loadEggTextures(
          '/assets/egg.png',
          '/assets/egg_broken.png',
        );
        this._applyEggTextures(fullTex, brokenTex);
        this._eggSpriteKey = key;
      } catch (fallbackErr) {
        this.fullEggSprite = null;
        this.brokenEggSprite = null;
        this._eggSpriteKey = null;
      }
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

  async _loadEggSprites() {
    if (this.fullEggSprite || this.brokenEggSprite) return;
    try {
      const { fullTex, brokenTex } = await this._loadEggTextures(
        '/assets/egg.png',
        '/assets/egg_broken.png',
      );
      this._applyEggTextures(fullTex, brokenTex);
      this._eggSpriteKey = 'default';
      this._renderPlay();
    } catch (err) {
      // Keep graphics egg if assets are missing.
      this.fullEggSprite = null;
      this.brokenEggSprite = null;
      this._eggSpriteKey = null;
    }
  }

  _syncEggSprites() {
    if (!this.fullEggSprite || !this.brokenEggSprite || !this.eggCenter) return;
    const { x, y, width, height } = this.eggCenter;
    const scaleX = width / this.fullEggSprite.texture.width;
    const scaleY = height / this.fullEggSprite.texture.height;
    const scale = Math.min(scaleX, scaleY);
    this.fullEggSprite.scale.set(scale);
    this.brokenEggSprite.scale.set(scale);
    this.eggSpriteContainer.position.set(x, y);
    this.fullEggSprite.position.set(0, 0);
    this.brokenEggSprite.position.set(0, 0);
    this.fullEggSprite.alpha = this.isCracked ? 0 : 1;
    this.brokenEggSprite.alpha = this.isCracked ? 1 : 0;
    this.eggSpriteContainer.visible = true;
  }

  async _knockAnim() {
    if (this._isKnocking || !this.eggCenter) return;
    this._isKnocking = true;
    const baseScale = this.eggSpriteContainer.scale.x || 1;
    const baseRot = this.eggSpriteContainer.rotation || 0;

    const tween = (durationMs, onUpdate) => new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const now = performance.now();
        const t = Math.min(1, (now - start) / durationMs);
        onUpdate(t);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    await tween(120, (t) => {
      const e = easeOutCubic(t);
      this.eggSpriteContainer.scale.set(baseScale * (1 - 0.04 * e), baseScale * (1 + 0.02 * e));
      this.eggSpriteContainer.rotation = baseRot + Math.sin(e * Math.PI) * 0.03;
    });

    const shakes = 8;
    for (let i = 0; i < shakes; i += 1) {
      this.eggSpriteContainer.rotation = baseRot + (i % 2 === 0 ? -0.02 : 0.02);
      await new Promise((r) => setTimeout(r, 20));
    }

    await tween(120, (t) => {
      const e = easeOutCubic(t);
      this.eggSpriteContainer.scale.set(baseScale * (0.96 + 0.04 * e), baseScale * (1.02 - 0.02 * e));
      this.eggSpriteContainer.rotation = baseRot * (1 - e);
    });

    this.eggSpriteContainer.scale.set(baseScale);
    this.eggSpriteContainer.rotation = baseRot;
    this._isKnocking = false;
  }

  _spawnShards() {
    if (!this.eggCenter) return;
    const { x, y } = this.eggCenter;
    const shardContainer = new Container();
    this.eggSpriteContainer.addChild(shardContainer);
    const shards = [];
    const count = 10;

    for (let i = 0; i < count; i += 1) {
      const g = new Graphics();
      g.beginFill(0xffffff, 0.9);
      g.moveTo(0, 0);
      g.lineTo(10 + Math.random() * 18, 0);
      g.lineTo(0, 10 + Math.random() * 18);
      g.closePath();
      g.endFill();
      g.x = (Math.random() - 0.5) * 40;
      g.y = (Math.random() - 0.5) * 40;
      g.rotation = Math.random() * Math.PI;
      shardContainer.addChild(g);
      shards.push({
        g,
        vx: (Math.random() - 0.5) * 16,
        vy: -6 - Math.random() * 8,
        vr: (Math.random() - 0.5) * 0.3,
        life: 60 + Math.floor(Math.random() * 20),
      });
    }

    const tickerFn = () => {
      for (const s of shards) {
        s.g.x += s.vx;
        s.g.y += s.vy;
        s.vy += 0.35;
        s.g.rotation += s.vr;
        s.life -= 1;
        s.g.alpha = Math.max(0, s.life / 80);
      }
      if (shards.every((s) => s.life <= 0)) {
        this.app.ticker.remove(tickerFn);
        shardContainer.destroy({ children: true });
      }
    };
    this.app.ticker.add(tickerFn);
  }

  _startBonusBounce() {
    if (!this.bonusText || this._bonusAnim) return;
    this.bonusText.scale.set(1);
    let frame = 0;
    const duration = 100;
    const tick = () => {
      frame = (frame + 1) % duration;
      const t = frame / duration;
      const scale = 1 + 0.2 * Math.sin(t * Math.PI * 2);
      this.bonusText.scale.set(scale);
    };
    this._bonusAnim = () => {
      this.app.ticker.remove(tick);
      this.bonusText.scale.set(1);
      this._bonusAnim = null;
    };
    this.app.ticker.add(tick);
  }

  _stopBonusBounce() {
    if (this._bonusAnim) {
      this._bonusAnim();
    }
  }

  _setStatus(message, textColor, bgColor) {
    this.statusText.text = message;
    this.statusText.style.fill = textColor;
    this._statusBgColor = bgColor;
    this._statusTextColor = textColor;
    const shouldShow = Boolean(message && message.trim());
    this.statusBg.visible = shouldShow;
    this.statusText.visible = shouldShow;
    if (shouldShow) {
      this._refreshStatusBadge();
    } else {
      this.statusBg.clear();
    }
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

    if (this.fullEggSprite && this.brokenEggSprite) {
      const tween = (durationMs, onUpdate) => new Promise((resolve) => {
        const start = performance.now();
        const tick = () => {
          const now = performance.now();
          const t = Math.min(1, (now - start) / durationMs);
          onUpdate(t);
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

      this._spawnShards();
      this.fullEggSprite.alpha = 1;
      this.brokenEggSprite.alpha = 0;

      return tween(220, (t) => {
        const e = easeOutCubic(t);
        this.fullEggSprite.alpha = 1 - e;
        this.brokenEggSprite.alpha = e;
      }).then(() => {
        this.fullEggSprite.alpha = 0;
        this.brokenEggSprite.alpha = 1;
      });
    }

    if (this.egg) {
      this.egg.alpha = 0;
    }
    if (this.crackOverlay) {
      this.crackOverlay.visible = false;
    }

    const { x, y, width, height } = this.eggCenter || { x: 0, y: 0, width: 200, height: 260 };
    const leftShell = new Graphics();
    const rightShell = new Graphics();
    const fragments = [];

    const shellFill = 0xf5d586;
    const shellStroke = 0xb88c1a;

    const sampleEllipse = (cx, cy, rx, ry, startDeg, endDeg, steps) => {
      const points = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const angle = (startDeg + (endDeg - startDeg) * t) * (Math.PI / 180);
        points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
      }
      return points;
    };

    const drawShellHalf = (gfx, side) => {
      gfx.clear();
      gfx.lineStyle(3, shellStroke, 1);
      gfx.beginFill(shellFill, 0.95);
      const isLeft = side === 'left';
      const outer = isLeft
        ? sampleEllipse(x, y, width / 2, height / 2, 120, 240, 9)
        : sampleEllipse(x, y, width / 2, height / 2, 60, -60, 9);
      const seamOffsets = [0.02, -0.01, 0.015, -0.02, 0.01, -0.015];
      const seamYs = [0.35, 0.2, 0.05, -0.08, -0.22, -0.34];
      const seam = seamYs.map((yoff, idx) => {
        const offset = width * (0.02 + seamOffsets[idx]);
        const sx = isLeft ? x + offset : x - offset;
        return [sx, y + yoff * height];
      });
      const points = outer.concat(seam);
      gfx.drawPolygon(points);
      gfx.endFill();
    };

    drawShellHalf(leftShell, 'left');
    drawShellHalf(rightShell, 'right');

    leftShell.alpha = 0.95;
    rightShell.alpha = 0.95;
    const fragmentCount = 2;
    for (let i = 0; i < fragmentCount; i += 1) {
      const frag = new Graphics();
      frag.beginFill(shellFill, 0.9);
      frag.lineStyle(2, shellStroke, 0.9);
      frag.drawPolygon([0, 0, 10, -6, 18, 6]);
      frag.endFill();
      frag.position.set(x + (i - 1.5) * 8, y - height * 0.05);
      frag.rotation = (i - 2) * 0.2;
      fragments.push({
        gfx: frag,
        vx: (i - 0.5) * 0.6,
        vy: -1.2 - i * 0.15,
        vr: (i % 2 === 0 ? 1 : -1) * 0.04,
      });
    }

    this.root.addChild(leftShell, rightShell, ...fragments.map((f) => f.gfx));

    let frame = 0;
    const duration = 32;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeIn = (t) => Math.pow(t, 2);

    const tick = () => {
      frame += 1;
      const t = Math.min(1, frame / duration);
      const eased = easeOut(t);
      const fall = easeIn(t);

      leftShell.position.set(-width * 0.18 * eased, (height * 0.6) * fall);
      leftShell.rotation = -0.45 * eased;
      leftShell.alpha = 0.95 * (1 - t * 0.4);

      rightShell.position.set(width * 0.18 * eased, (height * 0.6) * fall);
      rightShell.rotation = 0.45 * eased;
      rightShell.alpha = 0.95 * (1 - t * 0.4);

      fragments.forEach((frag) => {
        frag.gfx.position.x += frag.vx;
        frag.gfx.position.y += frag.vy + fall * 1.2;
        frag.gfx.rotation += frag.vr;
        frag.gfx.alpha = Math.max(0, 1 - t * 0.8);
      });

      if (frame >= duration) {
        this.app.ticker.remove(tick);
        leftShell.destroy();
        rightShell.destroy();
        fragments.forEach((frag) => frag.gfx.destroy());
        if (this.egg) {
          this.egg.alpha = 1;
        }
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
      fragments.forEach((frag) => frag.gfx.destroy());
      if (this.egg) {
        this.egg.alpha = 1;
      }
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

  _getSavedRowY(height = this.app?.renderer?.height || 600) {
    return Math.min(height * 0.72, height - 140);
  }
  // endregion utils / visuals ---------------------------------------------------

  // region helpers / state ------------------------------------------------------
  _recordHistory(status, egg, extra = {}) {
    this.history.unshift({
      status,
      eggId: egg?.uid ?? null,
      eggType: egg?.id ?? null,
      betAmount: egg?.bet ?? null,
      time: new Date(),
      ...extra,
    });
  }

  getHistory() {
    return this.history.slice();
  }
  _getActiveEgg() {
    return this._findEggByUid(this.activeEggUid, this.activeSource);
  }

  _findEggByUid(uid, source = 'bought') {
    if (!uid) return null;
    const pool = source === 'stored' ? this.storedEggs : this.boughtEggs;
    return pool.find((egg) => egg.uid === uid) || null;
  }

  _findLatestStoredById(id) {
    if (!id) return null;
    for (let i = this.storedEggs.length - 1; i >= 0; i -= 1) {
      if (this.storedEggs[i].id === id) return this.storedEggs[i];
    }
    return null;
  }

  _createEggInstance(template) {
    return {
      ...template,
      uid: makeUid(template.id || 'egg'),
      tries: 0,
      lastWinAmount: 0,
      lastCrackLevel: null,
    };
  }

  _toggleMode(mode) {
    this.mode = mode;
    if (this.homeDomRoot) {
      this.homeDomRoot.style.display = mode === 'home' ? 'flex' : 'none';
    }
    if (this.playContainer) this.playContainer.visible = mode === 'play';
    if (this.app?.canvas) {
      this.app.canvas.style.display = mode === 'play' ? 'block' : 'none';
    }
    if (this.homeButtonEl) {
      this.homeButtonEl.style.display = mode === 'play' ? 'inline-flex' : 'none';
    }
    if (this.storedBarRoot) {
      this.storedBarRoot.style.display = mode === 'play' ? 'flex' : 'none';
    }
    this._updateTabsVisibility();
  }

  _updateActionButtons() {
    const egg = this._getActiveEgg();
    const tries = egg?.tries ?? 0;
    const canCrack = !!egg && tries < this.maxCracks;
    const canCashout = tries > 0;
    const hideHome = tries > 0;
    const disableAlpha = 0.5;
    const disableMode = 'none';

    const setState = (btn, enabled) => {
      btn.alpha = enabled ? 1 : disableAlpha;
      btn.eventMode = enabled && !this.isLocked ? 'static' : disableMode;
    };

    setState(this.actionButton, canCrack);
    setState(this.cashoutButton, !!egg && canCashout);

    if (this.actionButton) this.actionButton.visible = !!egg;
    if (this.cashoutButton) {
      this.cashoutButton.visible = false;
      this.cashoutButton.eventMode = disableMode;
    }
    if (this.homeButtonEl) {
      this.homeButtonEl.style.display = !hideHome && this.mode === 'play' ? 'inline-flex' : 'none';
      this.homeButtonEl.disabled = hideHome || this.isLocked;
    }
  }

  _moveActiveToStored() {
    const egg = this._getActiveEgg();
    if (!egg) return;
    if (this.storedEggs.length >= this.maxStored) return;
    const exists = this.storedEggs.some((e) => e.uid === egg.uid);
    if (!exists) {
      this.storedEggs.push({ ...egg });
    }
    this._removeEggFromArray(this.boughtEggs, egg.uid);
    this.activeEggUid = null;
    this._renderHomeDom();
  }

  _removeActiveEgg() {
    if (!this.activeEggUid) return;
    this._removeEggFromArray(this.boughtEggs, this.activeEggUid);
    this._removeEggFromArray(this.storedEggs, this.activeEggUid);
    const had = this.activeEggUid;
    this.activeEggUid = null;
    return !!had;
  }

  _removeEggFromArray(arr, uid) {
    const idx = arr.findIndex((e) => e.uid === uid);
    if (idx >= 0) arr.splice(idx, 1);
  }

  lockUI(isLocked) {
    this.isLocked = isLocked;
    const alpha = isLocked ? 0.6 : 1;
    const mode = isLocked ? 'none' : 'static';
    [this.actionButton, this.cashoutButton, this.buyButton, this.backButton].forEach((btn) => {
      if (!btn) return;
      btn.alpha = alpha;
      btn.eventMode = mode;
    });
    this._updateTabsVisibility();
  }

  resize(width, height) {
    this._drawBackdrop(width, height);
    const centerY = height * 0.38;
    this._drawEgg(width / 2, centerY);

    // this.titleText.position.set(width / 2, 18);
    this.statusText.position.set(width / 2, 58);
    this._refreshStatusBadge();

    this.backButton.position.set(24, 24);
    this._storedBarTop = null;
    this._updateStoredBarLayout();

    this._renderHomeDom();
    this._renderPlay();
  }

  _positionActionButtons(width, height) {
    if (!this.actionButton) return;
    const gap = 12;
    const actionH = this.actionButton.height || 64;
    const marginBottom = 24;
    const rowYOffset = 20;
    const baseRowY = Math.min(height * 0.82, height - actionH - marginBottom);
    const rowY = baseRowY + rowYOffset;

    const leftBtn = this.actionButton.visible !== false ? this.actionButton : null;
    const rightBtn = null;

    if (leftBtn && rightBtn) {
      const totalWidth = leftBtn.width + rightBtn.width + gap;
      const startX = (width - totalWidth) / 2;
      leftBtn.position.set(startX, rowY);
      rightBtn.position.set(startX + leftBtn.width + gap, rowY);
    } else if (leftBtn) {
      leftBtn.position.set((width - leftBtn.width) / 2, rowY);
    } else if (rightBtn) {
      rightBtn.position.set((width - rightBtn.width) / 2, rowY);
    }

    const crackButton = leftBtn || rightBtn;
    if (crackButton) {
      this._positionStoredBar(crackButton.position.y);
    }
  }

  _positionStoredBar(crackButtonY) {
    if (!this.storedBarRoot) return;
  }
  // endregion helpers / state ---------------------------------------------------
}
