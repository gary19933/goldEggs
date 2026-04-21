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
    this.infoConfig = {
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
    this.eggCatalog = [
      { id: 'gold', label: 'Gold Egg', bet: 100 },
      { id: 'premium', label: 'Premium Egg', bet: 1000 },
    ];

    this.activeEggUid = null;
    this.activeSource = 'bought';
    this.isLocked = false;
    this.isCracked = false;
    this.lastResultText = '';
    this.lastBonus = false;
    this.history = [];
    this.activeTabId = 'gold';
    this.previousTabId = null;
    this._prevEggOnStoredLose = null;
    this.maxCracks = 12;

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

    this.eggLabelBg = new Sprite();
    this.eggLabelBg.anchor.set(0.5, 0.5);
    this.eggLabelBg.visible = false;
    this.playContainer.addChild(this.eggLabelBg);

    this.eggLabel = new Text('', {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 18,
      fontWeight: '800',
      fill: 0xffffff,
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

    this.actionButton = this._createButton('Crack', () => {
      if (this.isLocked) return;
      this._handleCrack();
    }, { width: 300, height: 78, fontSize: 22, textOffsetY: -3 });
    this.playContainer.addChild(this.actionButton);

    this.buyButton = this._createButton('Buy Egg', () => {
      if (this.isLocked) return;
      this._handleBuy();
    }, { width: 380, height: 90, color: 0x6d4c41, fontSize: 22 });
    this.playContainer.addChild(this.buyButton);

    this.cashoutButton = null;

    this.backButton = this._createButton('🏠', () => {
      if (this.isLocked) return;
      this._goHome();
    }, { width: 64, height: 46, color: 0x4e342e, fontSize: 22 });
    this.backButton.visible = false;
    this.playContainer.addChild(this.backButton);
    this._updatePrimaryButtonSkins();

    this._toggleMode('play');
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
        width: '95px',
        height: '44px',
        padding: '0 12px',
        backgroundColor: 'transparent',
        backgroundImage: 'url("/assets/interface/info-btn.png")',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        color: '#ffffff',
        border: 'none',
        borderRadius: '0',
        fontWeight: '700',
        fontSize: '14px',
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

    buttonWrap.appendChild(infoBtn);
    buttonWrap.appendChild(rewardsBtn);

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
      padding: '0',
      background: 'transparent',
      border: 'none',
      borderRadius: '0',
      zIndex: '9',
    });

    this.containerEl.appendChild(tabs);
    this.tabsRoot = tabs;
    this.tabButtons = {};
    this._renderEggTabs();
    this._refreshEggTabs();
  }

  _renderEggTabs() {
    if (!this.tabsRoot) return;
    this.tabsRoot.innerHTML = '';
    this.tabButtons = {};

    const makeTab = (id, label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        padding: '8px 18px',
        backgroundColor: 'transparent',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        color: '#fff4cf',
        border: '2px solid transparent',
        borderRadius: '12px',
        fontWeight: '800',
        cursor: 'pointer',
        minWidth: id === 'premium' ? '250px' : '220px',
        minHeight: '46px',
        boxShadow: 'none',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
      });
      btn.onclick = () => this._selectEggTab(id);
      return btn;
    };

    const templates = Array.isArray(this.eggCatalog) ? this.eggCatalog : [];
    templates.forEach((template) => {
      if (!template?.id) return;
      const label = this._formatTabLabel(template);
      const button = makeTab(template.id, label);
      this.tabsRoot.appendChild(button);
      this.tabButtons[template.id] = button;
    });
    this._updateTabLayout();
  }

  _formatTabLabel(template) {
    const amount = typeof template?.bet === 'number' ? template.bet : 0;
    const label = template?.label || template?.id || 'Egg';
    return `${label} - ${this._formatMoney(amount)}`;
  }

  _getCurrency() {
    return this.currency || 'RM';
  }

  _formatMoney(amount) {
    return `${this._getCurrency()}${amount ?? 0}`;
  }

  _getTabImage(tabId, isActive) {
    const normalizedId = typeof tabId === 'string' ? tabId.toLowerCase() : '';
    if (normalizedId === 'premium') {
      return isActive
        ? '/assets/interface/premium/main-button.png'
        : '/assets/interface/premium/main-button-hover-premium.png';
    }
    return isActive
      ? '/assets/interface/gold/main-button-hover-gold.png'
      : '/assets/interface/gold/main-button-hover-premium.png';
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
      backgroundImage: 'url("/assets/interface/store-bg.png")',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
      border: 'none',
      borderRadius: '14px',
      zIndex: '9',
      width: 'fit-content',
      maxWidth: 'calc(100vw - 24px)',
      overflowX: 'auto',
      scrollbarWidth: 'none',
    });

    this.containerEl.appendChild(bar);
    this.storedBarRoot = bar;
    this.storedSlots = [];
    this._syncStoredSlots();
    this._updateStoredBarLayout();
    this._renderStoredBar();
  }

  _createStoredSlot() {
    const slot = document.createElement('div');
    Object.assign(slot.style, {
      width: '150px',
      minHeight: '54px',
      borderRadius: '12px',
      border: 'none',
      color: '#ffe082',
      fontWeight: '700',
      fontSize: '13px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px 8px',
      textAlign: 'center',
      backgroundImage: 'url("/assets/interface/empty-1.png")',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
      flex: '0 0 auto',
    });
    return slot;
  }

  _syncStoredSlots() {
    if (!this.storedBarRoot) return;
    const targetCount = Math.max(1, Number(this.maxStored) || 3);
    this.storedSlots = this.storedSlots || [];
    while (this.storedSlots.length < targetCount) {
      const slot = this._createStoredSlot();
      this.storedBarRoot.appendChild(slot);
      this.storedSlots.push(slot);
    }
    while (this.storedSlots.length > targetCount) {
      const slot = this.storedSlots.pop();
      slot?.remove();
    }
  }

  _renderStoredBar() {
    if (!this.storedSlots) return;
    this._syncStoredSlots();
    const eggs = this.storedEggs.slice(0, this.maxStored);
    this.storedSlots.forEach((slot, index) => {
      const egg = eggs[index];
      slot.innerHTML = '';
      slot.style.backgroundImage = 'url("/assets/interface/empty-1.png")';
      slot.style.borderStyle = 'none';
      slot.style.cursor = 'default';
      slot.onclick = null;
      if (!egg) {
        const empty = document.createElement('div');
        empty.textContent = 'Empty';
        empty.style.color = '#fffaf0';
        slot.appendChild(empty);
        return;
      }
      const label = document.createElement('div');
      const hasWon = (egg.tries ?? 0) > 0 && typeof egg.lastWinAmount === 'number' && egg.lastWinAmount > 0;
      label.textContent = hasWon
        ? `${egg.label ?? egg.id ?? 'Egg'} ${this._formatMoney(egg.lastWinAmount)}`
        : `${egg.label ?? egg.id ?? 'Egg'}`;
      label.style.color = '#fffaf0';
      label.style.marginBottom = '6px';

      const isActive = egg.uid === this.activeEggUid;
      const isMaxed = egg.isMaxed === true;
      slot.style.backgroundImage = isActive
        ? 'url("/assets/interface/empty-1-hover.png")'
        : 'url("/assets/interface/empty-1.png")';

      slot.appendChild(label);
      if (egg.uid !== this.activeEggUid && !isMaxed) {
        const btn = document.createElement('button');
        btn.textContent = 'Retrieve';
        Object.assign(btn.style, {
          width: '72px',
          height: '20px',
          padding: '0',
          backgroundColor: 'transparent',
          backgroundImage: 'url("/assets/interface/retrieve.png")',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          color: '#161616',
          border: 'none',
          fontWeight: '700',
          fontSize: '9px',
          cursor: 'pointer',
        });
        btn.onclick = () => {
          if (this.isLocked) return;
          this._retrieveStoredEgg(egg);
        };
        slot.appendChild(btn);
      }
    });
  }

  _refreshEggTabs() {
    if (!this.tabButtons) return;
    const hasActiveEgg = Boolean(this.activeEggUid);
    Object.entries(this.tabButtons).forEach(([id, btn]) => {
      const active = !hasActiveEgg && id === this.activeTabId;
      btn.style.backgroundImage = `url("${this._getTabImage(id, active)}")`;
      btn.style.borderColor = 'transparent';
      btn.style.boxShadow = 'none';
      btn.style.color = active ? '#fffaf0' : '#161616';
      btn.style.opacity = active ? '1' : '0.96';
      btn.style.textShadow = active ? '0 1px 2px rgba(0,0,0,0.5)' : 'none';
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
      backgroundColor: 'transparent',
      backgroundImage: 'url("/assets/interface/box.png")',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
      border: 'none',
      borderRadius: '16px',
      padding: '52px 52px',
      maxWidth: '560px',
      width: '100%',
      maxHeight: '88vh',
      color: '#ffe082',
      boxShadow: '0 18px 36px rgba(0,0,0,0.45)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      overflow: 'hidden',
    });

    const title = document.createElement('h2');
    Object.assign(title.style, {
      margin: '0',
      fontWeight: '900',
      fontSize: '24px',
      color: '#ffffff',
      textAlign: 'center',
      flex: '1',
    });

    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
    });

    const closeX = document.createElement('button');
    closeX.textContent = '';
    closeX.setAttribute('aria-label', 'Close');
    Object.assign(closeX.style, {
      width: '34px',
      height: '34px',
      backgroundColor: 'transparent',
      backgroundImage: 'url("/assets/interface/close.png")',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
      border: 'none',
      borderRadius: '0',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: 'none',
    });
    closeX.onclick = () => this._closeModal();

    headerRow.appendChild(document.createElement('div'));
    headerRow.appendChild(title);
    headerRow.appendChild(closeX);

    const body = document.createElement('div');
    Object.assign(body.style, {
      fontSize: '16px',
      lineHeight: '2.5',
      color: '#ffffff',
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
    const viewportHeight = window.innerHeight || 0;
    const isTablet = viewportWidth > 520 && viewportWidth <= 920;
    const isMobile = viewportWidth <= 520;
    const isLargeDesktop = viewportWidth >= 1360 || viewportHeight >= 860;
    const slotWidth = isMobile ? 100 : isTablet ? 120 : 150;
    const slotMinHeight = isMobile ? 46 : isTablet ? 50 : 54;
    const fontSize = isMobile ? 11 : isTablet ? 12 : 13;
    const padding = isMobile ? '8px 10px' : isTablet ? '9px 11px' : '10px 12px';
    const gap = isMobile ? '8px' : isTablet ? '10px' : '12px';
    this.storedBarRoot.style.padding = padding;
    this.storedBarRoot.style.gap = gap;
    const top = isMobile ? '170px' : isTablet ? '170px' : isLargeDesktop ? '142px' : '150px';
    this.storedBarRoot.style.maxWidth = 'none';
    this.storedBarRoot.style.top = top;
    if (this.tabsRoot) {
      this.tabsRoot.style.top = isMobile ? '92px' : isLargeDesktop ? '84px' : '92px';
    }
    this._updateTabLayout();

    this.storedSlots.forEach((slot) => {
      slot.style.width = `${slotWidth}px`;
      slot.style.minHeight = `${slotMinHeight}px`;
      slot.style.fontSize = `${fontSize}px`;
    });
  }

  _updateTabLayout() {
    if (!this.tabsRoot || !this.tabButtons) return;
    const viewportWidth = window.innerWidth || 0;
    const isMobile = viewportWidth <= 520;
    const isTablet = viewportWidth > 520 && viewportWidth <= 920;

    if (isMobile) {
      this.tabsRoot.style.left = '12px';
      this.tabsRoot.style.right = '12px';
      this.tabsRoot.style.transform = 'none';
      this.tabsRoot.style.width = 'auto';
      this.tabsRoot.style.gap = '8px';
    } else {
      this.tabsRoot.style.left = '50%';
      this.tabsRoot.style.right = 'auto';
      this.tabsRoot.style.transform = 'translateX(-50%)';
      this.tabsRoot.style.width = 'fit-content';
      this.tabsRoot.style.gap = isTablet ? '8px' : '10px';
    }

    Object.entries(this.tabButtons).forEach(([id, btn]) => {
      if (isMobile) {
        btn.style.flex = '1 1 0';
        btn.style.minWidth = '0';
        btn.style.width = '0';
        btn.style.padding = '8px 10px';
        btn.style.fontSize = id === 'premium' ? '11px' : '12px';
      } else if (isTablet) {
        btn.style.flex = '0 0 auto';
        btn.style.width = 'auto';
        btn.style.minWidth = id === 'premium' ? '220px' : '190px';
        btn.style.padding = '8px 14px';
        btn.style.fontSize = '14px';
      } else {
        btn.style.flex = '0 0 auto';
        btn.style.width = 'auto';
        btn.style.minWidth = id === 'premium' ? '250px' : '220px';
        btn.style.padding = '8px 18px';
        btn.style.fontSize = '16px';
      }
    });
  }

  _showModal(title, message) {
    if (!this.modalRoot) return;
    this.modalTitle.textContent = title;
    if (this.modalCloseX) {
      this.modalCloseX.style.display = 'inline-flex';
    }
    this.modalBody.innerHTML = '';
    this.modalBody.classList.remove('history-body');
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

  _getBackgroundImageForTab(tabId) {
    const normalizedId = typeof tabId === 'string' ? tabId.toLowerCase() : '';
    if (normalizedId === 'premium') {
      return '/assets/interface/premium/premium-bg.png';
    }
    return '/assets/interface/gold/gold-bg.png';
  }

  _applyPageBackground(tabId = this.activeTabId) {
    if (!this.containerEl) return;
    const backgroundUrl = this._getBackgroundImageForTab(tabId);
    this.containerEl.style.backgroundImage = `url("${backgroundUrl}")`;
    this.containerEl.style.backgroundPosition = 'center';
    this.containerEl.style.backgroundSize = 'cover';
    this.containerEl.style.backgroundRepeat = 'no-repeat';
  }

  _getButtonImageForType(eggType) {
    const normalizedId = typeof eggType === 'string' ? eggType.toLowerCase() : '';
    if (normalizedId === 'premium') {
      return '/assets/interface/premium/premium-button.png';
    }
    return '/assets/interface/gold/gold-button.png';
  }

  _getLabelImageForType(eggType) {
    const normalizedId = typeof eggType === 'string' ? eggType.toLowerCase() : '';
    if (normalizedId === 'premium') {
      return '/assets/interface/premium/premium-list-name.png';
    }
    return '/assets/interface/gold/gold-list-name.png';
  }

  _setButtonTexture(button, texture) {
    if (!button || !button._bgGraphics || !button._bgSprite) return;
    const targetWidth = button._baseWidth ?? button.width;
    const targetHeight = button._baseHeight ?? button.height;

    if (texture) {
      button._bgGraphics.visible = false;
      button._bgSprite.texture = texture;
      button._bgSprite.width = targetWidth;
      button._bgSprite.height = targetHeight;
      button._bgSprite.visible = true;
      if (button._glow) {
        button._glow.visible = false;
      }
      return;
    }

    button._bgSprite.visible = false;
    button._bgGraphics.visible = true;
    if (button._glow) {
      button._glow.visible = true;
    }
  }

  async _applyButtonSkin(button, eggType) {
    if (!button) return;
    const normalizedType = typeof eggType === 'string' ? eggType.toLowerCase() : '';
    const safeType = normalizedType === 'premium' ? 'premium' : 'gold';
    if (button._skinType === safeType && button._bgSprite?.visible) return;

    const requestId = (button._skinRequestId ?? 0) + 1;
    button._skinRequestId = requestId;
    button._skinType = safeType;

    const imageUrl = this._getButtonImageForType(safeType);
    try {
      const texture = await Assets.load(imageUrl);
      if (button._skinRequestId !== requestId) return;
      this._setButtonTexture(button, texture);
    } catch (error) {
      if (button._skinRequestId !== requestId) return;
      this._setButtonTexture(button, null);
    }
  }

  async _ensureEggLabelSkin(eggType) {
    if (!this.eggLabelBg) return;
    const normalizedType = typeof eggType === 'string' ? eggType.toLowerCase() : '';
    const safeType = normalizedType === 'premium' ? 'premium' : 'gold';
    if (this.eggLabelBg._skinType === safeType && this.eggLabelBg.texture) return;

    const requestId = (this.eggLabelBg._skinRequestId ?? 0) + 1;
    this.eggLabelBg._skinRequestId = requestId;
    this.eggLabelBg._skinType = safeType;

    try {
      const texture = await Assets.load(this._getLabelImageForType(safeType));
      if (this.eggLabelBg._skinRequestId !== requestId) return;
      this.eggLabelBg.texture = texture;
      const activeEgg = this._getActiveEgg();
      if ((activeEgg?.id ?? this.activeTabId) === safeType) {
        this._layoutEggLabelBackground(this.app?.renderer?.width || 800, this._playLayout?.labelY);
        this.eggLabelBg.visible = !!activeEgg;
      }
    } catch (error) {
      if (this.eggLabelBg._skinRequestId !== requestId) return;
      this.eggLabelBg.texture = null;
      this.eggLabelBg.visible = false;
    }
  }

  _layoutEggLabelBackground(width, labelY) {
    if (!this.eggLabelBg?.texture || typeof labelY !== 'number') {
      if (this.eggLabelBg) this.eggLabelBg.visible = false;
      return;
    }
    const targetWidth = Math.min(320, Math.max(220, width * 0.26));
    const targetHeight = targetWidth * (this.eggLabelBg.texture.height / this.eggLabelBg.texture.width);
    this.eggLabelBg.width = targetWidth;
    this.eggLabelBg.height = targetHeight;
    this.eggLabelBg.position.set(width / 2, labelY);
  }

  _updatePrimaryButtonSkins(activeEgg = this._getActiveEgg()) {
    const crackType = activeEgg?.id ?? this.activeTabId;
    const buyType = this._getSelectedEggTemplate()?.id ?? this.activeTabId;
    void this._applyButtonSkin(this.actionButton, crackType);
    void this._applyButtonSkin(this.buyButton, buyType);
  }

  // endregion setup -------------------------------------------------------------

  setConfig(config = {}) {
    this.currency = config.currency || this.currency || '';
    if (Array.isArray(config.eggs) && config.eggs.length > 0) {
      const normalized = config.eggs
        .map((egg) => ({
          id: typeof egg?.id === 'string' ? egg.id : '',
          label: typeof egg?.label === 'string' ? egg.label : (typeof egg?.id === 'string' ? egg.id : 'Egg'),
          bet: Number(egg?.bet) || 0,
        }))
        .filter((egg) => egg.id);
      if (normalized.length > 0) {
        this.eggCatalog = normalized;
      }
    }
    this._initTabEggs();
    this.maxStored = typeof config.maxStored === 'number' ? config.maxStored : 3;
    this.maxCracks = typeof config.maxCracks === 'number' ? config.maxCracks : this.maxCracks;
    if (config.info && typeof config.info === 'object') {
      const title = typeof config.info.title === 'string' && config.info.title.trim()
        ? config.info.title.trim()
        : this.infoConfig.title;
      const steps = Array.isArray(config.info.steps)
        ? config.info.steps
          .map((step) => (typeof step === 'string' ? step.trim() : ''))
          .filter(Boolean)
        : [];
      if (steps.length > 0) {
        this.infoConfig = { title, steps };
      }
    }
    this._syncStoredSlots();
    this._renderEggTabs();
    this._refreshEggTabs();
    this._renderHomeDom();
    this._renderPlay();
  }

  applyServerState(state = {}) {
    const normalizeEgg = (egg) => {
      if (!egg?.uid) return null;
      const template = this.eggCatalog.find((item) => item.id === egg.id) || null;
      return {
        ...(template || {}),
        ...egg,
        id: typeof egg?.id === 'string' ? egg.id : (template?.id ?? 'gold'),
        label: typeof egg?.label === 'string' ? egg.label : (template?.label ?? egg?.id ?? 'Egg'),
        bet: Number(egg?.bet) || 0,
        tries: Number(egg?.tries) || 0,
        lastWinAmount: Number(egg?.lastWinAmount) || 0,
        isMaxed: Boolean(egg?.isMaxed),
      };
    };
    const normalizedEggs = Array.isArray(state.eggs)
      ? state.eggs.map(normalizeEgg).filter(Boolean)
      : [];
    const eggById = new Map(normalizedEggs.map((egg) => [egg.uid, egg]));
    const storedIds = Array.isArray(state.storedEggIds) && state.storedEggIds.length
      ? state.storedEggIds
      : normalizedEggs.map((egg) => egg.uid);

    this.boughtEggs = normalizedEggs;
    this.storedEggs = storedIds
      .map((uid) => eggById.get(uid))
      .filter(Boolean);
    this.activeEggUid = typeof state.activeEggUid === 'string' ? state.activeEggUid : null;
    this.activeSource = this.activeEggUid && this.storedEggs.some((egg) => egg.uid === this.activeEggUid)
      ? 'stored'
      : 'bought';
    this.history = Array.isArray(state.history)
      ? state.history.map((entry) => ({
        ...entry,
        time: entry?.time ? new Date(entry.time) : new Date(),
      }))
      : this.history;

    const activeEgg = this._getActiveEgg();
    if (activeEgg?.id) {
      this.activeTabId = activeEgg.id;
    } else {
      const hasActiveTab = this.eggCatalog.some((egg) => egg.id === this.activeTabId);
      this.activeTabId = hasActiveTab ? this.activeTabId : (this.eggCatalog[0]?.id ?? 'gold');
    }

    this._applyPageBackground(activeEgg?.id ?? this.activeTabId);
    this._updatePrimaryButtonSkins();
    this._refreshEggTabs();
    this._updateBuyButtonLabel();
    this._updateActionButtons();
    this._renderStoredBar();
    this._renderHomeDom();
    this._renderPlay();
  }

  _initTabEggs() {
    this.boughtEggs = [];
    this.storedEggs = [];
    const hasActiveTab = this.eggCatalog.some((egg) => egg.id === this.activeTabId);
    this.activeTabId = hasActiveTab ? this.activeTabId : (this.eggCatalog[0]?.id ?? 'gold');
    this.activeEggUid = null;
    this.activeSource = 'bought';
    this._applyPageBackground(this.activeTabId);
    this._updatePrimaryButtonSkins();
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
    const {
      result: outcome,
      winAmount = 0,
      balance,
      eggId,
      bonus,
      chargeAmount = 0,
      tryIndex,
      state,
    } = result;
    if (balance !== undefined) {
      this.updateBalance(balance);
    }

    const egg = eggId ? this._findEggByUid(eggId, this.activeSource) : this._getActiveEgg();
    const storedEgg = eggId ? this._findEggByUid(eggId, 'stored') : null;

    if (outcome === 'stored') {
      this.lastBonus = false;
      await this._playStoreAnimation();
      if (state) {
        this.applyServerState(state);
      } else {
        this._recordHistory(1, egg, { actionType: 'stored' });
        this._moveActiveToStored();
      }
      this._showToast('Your egg has been stored successfully.', 'success');
      this.lockUI(false);
      return;
    }

    if (outcome === 'bought' || outcome === 'retrieved') {
      this.lastBonus = false;
      if (state) {
        this.applyServerState(state);
      }
      this.lockUI(false);
      return;
    }

    if (outcome === 'redeemed') {
      this.lastBonus = false;
      const targetEgg = storedEgg || egg;
      if (!state && targetEgg) {
        this._removeEggFromArray(this.storedEggs, targetEgg.uid);
        this._removeEggFromArray(this.boughtEggs, targetEgg.uid);
        if (this.activeEggUid === targetEgg.uid) {
          this.activeEggUid = null;
        }
      }
      if (state) {
        this.applyServerState(state);
      } else {
        this._recordHistory(2, targetEgg, { winAmount, chargeAmount, actionType: 'redeemed' });
      }
      this._showToast('Egg redeemed successfully.', 'success');
      this._toggleMode('play');
      this._renderPlay();
      this.lockUI(false);
      return;
    }

    if (outcome === 'win' || outcome === 'lose') {
      this.isCracked = true;
      this.lastBonus = Boolean(bonus);
      this._drawCrackOverlay();
      await this._playBreakAnimation();

      if (egg) {
        const nextTries = typeof tryIndex === 'number'
          ? tryIndex
          : Math.min(this.maxCracks, (egg.tries ?? 0) + 1);
        egg.tries = Math.min(this.maxCracks, Math.max(0, nextTries));
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
        this.lastResultText = bonus ? `Bonus won ${this._formatMoney(winAmount)}` : `Won ${this._formatMoney(winAmount)}`;
        if (!state) {
          this._recordHistory(1, egg, { winAmount, chargeAmount, actionType: 'win' });
        }
      // this._setStatus(`Fortune found! +${winAmount}`, 0x8cff66, 0xe4ffd8);
      // this._flashEgg(0x9ccc65);
      this._showToast(
        bonus ? `Bonus hit! +${this._formatMoney(winAmount)}` : `Fortune found! +${this._formatMoney(winAmount)}`,
        'success',
      );
    } else {
      if (!state) {
        this._removeActiveEgg();
      }
      this.lastBonus = false;
      this.lastResultText = bonus ? 'Bonus round missed' : 'Try again later';
        if (!state) {
          this._recordHistory(0, egg, { chargeAmount, actionType: 'lose' });
        }
        this._setStatus('', 0xffccbc, 0x2d0d0d);
        // this._flashEgg(0xff7043);
        this._showToast(bonus ? 'Bonus round missed' : 'Try again later', 'error');
      }
      if (state) {
        this.applyServerState(state);
      }
      this._showResultModalAndReset(outcome === 'win', winAmount, egg, Boolean(bonus));
    } else {
      this.lastBonus = false;
      if (state) {
        this.applyServerState(state);
      }
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
      eggType: egg.id,
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
    if (this.onAction) {
      this.lockUI(true);
      void this.onAction({
        action: 'buy',
        betAmount: template.bet,
        eggType: template.id,
      });
      return;
    }
    const newEgg = this._createEggInstance(template);
    this.boughtEggs.push(newEgg);
    this.storedEggs.push(newEgg);
    this._recordHistory(1, newEgg, { actionType: 'buy', chargeAmount: template.bet ?? 0 });
    this._renderStoredBar();
    this._enterPlay(newEgg, 'stored');
  }

  _showResultModalAndReset(didWin, winAmount, egg, didBonus = false) {
    const amountText = typeof winAmount === 'number' ? winAmount : 0;
    const title = didWin ? (didBonus ? 'Bonus Hit' : 'Congratulations') : 'Out Of Luck';
    const message = didWin
      ? (didBonus ? `Bonus success! You have won ${this._formatMoney(amountText)}.` : `You have won ${this._formatMoney(amountText)}.`)
      : (didBonus ? 'Bonus round missed. Try again next time!' : 'Try again next time!');
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
        width: '138px',
        height: '56px',
        padding: '0',
        backgroundColor: 'transparent',
        backgroundImage: 'url("/assets/interface/confirm.png")',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        color: '#161616',
        border: 'none',
        borderRadius: '0',
        fontWeight: '700',
        fontSize: '18px',
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
    if (this.onAction) {
      this.lockUI(true);
      void this.onAction({
        action: 'retrieve',
        betAmount: egg.bet,
        eggId: egg.uid,
        eggType: egg.id,
        tryIndex: egg.tries ?? 0,
      });
      return;
    }
    this._recordHistory(1, egg, { actionType: 'retrieve' });
    this._enterPlay(egg, 'stored');
  }

  async _purchaseEgg(template) {
    // Purchases happen outside; this path is unused.
    return template;
  }

  _getSelectedEggTemplate() {
    const matched = this.eggCatalog.find((egg) => egg.id === this.activeTabId);
    if (matched) return { ...matched };
    const fallback = this.eggCatalog[0] || { id: 'gold', label: 'Gold Egg', bet: 100 };
    return { ...fallback };
  }

  _selectEggTab(tabId) {
    const current = this._getActiveEgg();
    this.activeTabId = tabId;
    this._applyPageBackground(this.activeTabId);
    this._updatePrimaryButtonSkins();
    this._refreshEggTabs();
    this._updateBuyButtonLabel();
    if (current) {
      if (this.onAction) {
        this.lockUI(true);
        void this.onAction({
          action: 'store',
          betAmount: current.bet,
          eggId: current.uid,
          eggType: current.id,
          tryIndex: current.tries ?? 0,
        });
        return;
      }
      const alreadyStored = this.storedEggs.some((item) => item.uid === current.uid);
      if (!alreadyStored && this.storedEggs.length >= this.maxStored) {
        this._showToast(`Storage is full (${this.maxStored}/${this.maxStored}).`, 'error');
        return;
      }
      if (!alreadyStored) {
        this.storedEggs.push(current);
      }
      this._recordHistory(1, current, { actionType: 'stored' });
      this.activeEggUid = null;
      this.isCracked = false;
      this.lastResultText = '';
      this._renderStoredBar();
    }
    this._renderPlay();
  }

  _enterPlay(egg, source = 'bought') {
    if (!egg) return;
    this.activeEggUid = egg.uid;
    this.activeSource = source;
    this.isCracked = false;
    this._applyPageBackground(egg.id ?? this.activeTabId);
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
          emptyText: `You can store up to ${this.maxStored} eggs for later.`,
          columns: `repeat(${Math.min(this.maxStored, 3)}, minmax(220px, 1fr))`,
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
    const playMetrics = this._getPlayMetrics(width, height);
    this._playLayout = playMetrics;
    const egg = this._getActiveEgg();
    const hasEgg = Boolean(egg);
    this._applyPageBackground(egg?.id ?? this.activeTabId);
    const displayAmount = egg && typeof egg.lastWinAmount === 'number' && egg.lastWinAmount > 0
      ? egg.lastWinAmount
      : null;
    const pricePart =
      egg && typeof displayAmount === 'number' && displayAmount > 0 ? ` ${this._formatMoney(displayAmount)}` : '';
    const label = egg ? `${egg.label ?? egg.id ?? 'Egg'}${pricePart}` : '';
    this.eggLabel.text = label;
    this.eggLabel.position.set(width / 2, playMetrics.labelY);
    if (egg) {
      void this._ensureEggLabelSkin(egg.id);
      this._layoutEggLabelBackground(width, playMetrics.labelY);
    } else if (this.eggLabelBg) {
      this.eggLabelBg.visible = false;
    }

    this.triesText.text = '';

    if (!hasEgg) {
      this.isCracked = false;
      this.lastBonus = false;
    }
    this._updatePrimaryButtonSkins(egg);
    if (hasEgg) {
      this._ensureEggSprites(egg);
    }
    this._drawEgg(width / 2, playMetrics.eggCenterY, playMetrics.eggWidth, playMetrics.eggHeight);
    this._drawCrackOverlay();
    this.egg.visible = hasEgg;
    if (this.eggLabelBg) {
      this.eggLabelBg.visible = hasEgg && !!this.eggLabelBg.texture;
    }
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
      const buyWidth = this.buyButton._baseWidth ?? this.buyButton.width;
      const buyHeight = this.buyButton._baseHeight ?? this.buyButton.height;
      this.buyButton.position.set(
        width / 2 - buyWidth / 2,
        height / 2 - buyHeight / 2,
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
    this.buyButton._labelText.text = `Buy ${template.label} ${this._formatMoney(amount)}`;
    const buyWidth = this.buyButton._baseWidth ?? this.buyButton.width;
    const buyHeight = this.buyButton._baseHeight ?? this.buyButton.height;
    this.buyButton._labelText.position.set(buyWidth / 2, buyHeight / 2);
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
      price.textContent = this._formatMoney(group.bet);
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
    this._showModal(this.infoConfig.title || 'How To Play', '');
    if (!this.modalBody) return;

    const steps = Array.isArray(this.infoConfig.steps) && this.infoConfig.steps.length > 0
      ? this.infoConfig.steps
      : ['Please contact support for game instructions.'];

    this.modalBody.innerHTML = '';
    this.modalBody.style.display = 'flex';
    this.modalBody.style.flexDirection = 'column';
    this.modalBody.style.gap = '22px';
    this.modalBody.style.whiteSpace = 'normal';
    this.modalBody.style.paddingTop = '8px';
    this.modalBody.style.paddingRight = '10px';
    this.modalBody.style.maxHeight = '58vh';
    this.modalBody.style.overflowY = 'auto';
    this.modalBody.style.scrollbarWidth = 'thin';
    this.modalBody.style.scrollbarColor = 'rgba(255, 213, 79, 0.45) rgba(255, 255, 255, 0.06)';

    const divider = document.createElement('div');
    Object.assign(divider.style, {
      position: 'relative',
      height: '18px',
      marginBottom: '4px',
      opacity: '0.95',
    });

    const dividerLine = document.createElement('div');
    Object.assign(dividerLine.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '50%',
      height: '1px',
      transform: 'translateY(-50%)',
      background: 'linear-gradient(90deg, rgba(194,122,35,0.1) 0%, rgba(242,178,73,0.95) 48%, rgba(194,122,35,0.1) 100%)',
      boxShadow: '0 0 10px rgba(242,178,73,0.45)',
    });

    const dividerGem = document.createElement('div');
    dividerGem.textContent = '✦';
    Object.assign(dividerGem.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#ffd36b',
      fontSize: '18px',
      lineHeight: '1',
      padding: '0 10px',
      background: '#000',
      textShadow: '0 0 10px rgba(255, 211, 107, 0.6)',
    });

    divider.appendChild(dividerLine);
    divider.appendChild(dividerGem);
    this.modalBody.appendChild(divider);

    steps.forEach((step, index) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: '40px 1fr',
        columnGap: '22px',
        alignItems: 'start',
      });

      const badge = document.createElement('div');
      badge.textContent = String(index + 1);
      Object.assign(badge.style, {
        width: '30px',
        height: '30px',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffbf47',
        fontSize: '20px',
        fontWeight: '800',
        lineHeight: '1',
        background: 'radial-gradient(circle at 35% 35%, rgba(255,189,87,0.12), rgba(0,0,0,0.92) 62%)',
        border: '1px solid rgba(255, 176, 54, 0.6)',
        boxShadow: '0 0 0 2px rgba(255, 176, 54, 0.12), inset 0 0 14px rgba(255, 176, 54, 0.08)',
      });

      const textWrap = document.createElement('div');
      Object.assign(textWrap.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minWidth: '0',
      });

      const text = document.createElement('div');
      text.textContent = step;
      Object.assign(text.style, {
        color: '#ffffff',
        fontSize: '14px',
        lineHeight: '1.5',
      });

      textWrap.appendChild(text);

      if (index < steps.length - 1) {
        const separator = document.createElement('div');
        Object.assign(separator.style, {
          height: '1px',
          width: '100%',
          background: 'linear-gradient(90deg, rgba(255, 176, 54, 0.08) 0%, rgba(255, 176, 54, 0.45) 25%, rgba(255, 176, 54, 0.45) 75%, rgba(255, 176, 54, 0.08) 100%)',
        });
        textWrap.appendChild(separator);
      }

      row.appendChild(badge);
      row.appendChild(textWrap);
      this.modalBody.appendChild(row);
    });
  }

  _showHistoryModal() {
    if (!this.history.length) {
      this._showModal('History', 'No game history yet.');
      return;
    }
    this._showModal('History', '');
    this.modalBody.style.display = 'flex';
    this.modalBody.style.flexDirection = 'column';
    this.modalBody.style.gap = '22px';
    this.modalBody.style.maxHeight = '58vh';
    this.modalBody.style.overflowY = 'auto';
    this.modalBody.style.paddingRight = '10px';
    this.modalBody.style.paddingBottom = '10px';
    this.modalBody.style.scrollbarWidth = 'thin';
    this.modalBody.style.scrollbarColor = 'rgba(255, 255, 255, 0.72) rgba(255, 255, 255, 0.08)';
    this.modalBody.classList.add('history-body');

    if (!document.getElementById('history-scrollbar-style')) {
      const style = document.createElement('style');
      style.id = 'history-scrollbar-style';
      style.textContent = `
        #game-modal .history-body::-webkit-scrollbar { width: 6px; }
        #game-modal .history-body::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.08); border-radius: 6px; }
        #game-modal .history-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.72); border-radius: 6px; }
        #game-modal .history-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.9); }
      `;
      document.head.appendChild(style);
    }

    const typeLabel = (value) => {
      if (typeof value !== 'string' || !value.length) return 'Egg';
      return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    };
    const currentSummaryState = (eggId) => {
      if (!eggId) return null;
      if (this.activeEggUid === eggId) return 'active';
      if (this.storedEggs.some((egg) => egg?.uid === eggId)) return 'stored';
      return null;
    };
    const statusLabel = (entry) => {
      const currentState = currentSummaryState(entry?.eggId);
      if (currentState === 'stored') return 'Stored';
      if (currentState === 'active' && entry?.actionType === 'buy') return 'Active';
      if (entry?.actionType === 'redeemed') return 'Redeemed';
      if (entry?.actionType === 'stored') return 'Stored';
      if (entry?.actionType === 'retrieve') return 'Retrieved';
      if (entry?.actionType === 'buy') return 'Bought';
      if (entry?.status === 0) return 'Lose';
      return 'Win';
    };
    const statusStyle = (entry) => {
      const currentState = currentSummaryState(entry?.eggId);
      if (currentState === 'active' && entry?.actionType === 'buy') {
        return { bg: 'rgba(255, 183, 77, 0.18)', color: '#ffe0b2' };
      }
      if (currentState === 'stored') return { bg: 'rgba(158, 158, 158, 0.18)', color: '#eceff1' };
      if (entry?.actionType === 'redeemed') return { bg: 'rgba(255, 213, 79, 0.2)', color: '#ffe082' };
      if (entry?.actionType === 'stored') {
        return { bg: 'rgba(158, 158, 158, 0.18)', color: '#eceff1' };
      }
      if (entry?.actionType === 'retrieve') {
        return { bg: 'rgba(121, 134, 203, 0.2)', color: '#e8eaf6' };
      }
      if (entry?.actionType === 'buy') {
        return { bg: 'rgba(255, 183, 77, 0.18)', color: '#ffe0b2' };
      }
      if (entry?.status === 0) return { bg: 'rgba(229, 57, 53, 0.2)', color: '#ffcdd2' };
      return { bg: 'rgb(39 245 6 / 20%)', color: 'rgb(213 255 205)' };
    };
    const visibleEntries = (entries = []) => entries.filter((entry) => entry?.actionType !== 'buy');
    const eventLabel = (entry) => {
      const crackNumber = Number.isInteger(entry?.tryIndex) && entry.tryIndex > 0 ? entry.tryIndex : null;
      const crackText = Number.isInteger(crackNumber) ? `Crack #${crackNumber}` : null;
      const eggText = typeLabel(entry?.eggType);
      switch (entry?.actionType) {
        case 'stored':
          return crackNumber && crackNumber > 0 ? `Stored after ${crackText}` : 'Stored egg';
        case 'retrieve':
          return 'Retrieved stored egg';
        case 'redeemed':
          return entry?.winAmount ? `Redeemed ${this._formatMoney(entry.winAmount)}` : 'Redeemed';
        case 'win':
          return crackText ? `${crackText} • Win` : 'Win';
        case 'lose':
          return crackText ? `${crackText} • Lose` : 'Lose';
        default:
          return crackText || 'Updated';
      }
    };

    const grouped = [];
    const groupMap = new Map();
    this.history.forEach((entry) => {
      const key = entry?.eggId || `ungrouped-${grouped.length}`;
      if (!groupMap.has(key)) {
        const group = { key, latest: entry, entries: [] };
        groupMap.set(key, group);
        grouped.push(group);
      }
      groupMap.get(key).entries.push(entry);
    });

    grouped.forEach((group, index) => {
      const latest = group.latest;
      const entries = visibleEntries(group.entries);
      const panel = document.createElement('details');
      panel.open = index === 0;
      Object.assign(panel.style, {
        background: 'rgba(8, 8, 10, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '12px',
        overflow: 'hidden',
        flexShrink: '0',
        boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
      });
      panel.addEventListener('toggle', () => {
        if (!panel.open) return;
        Array.from(this.modalBody?.querySelectorAll('details') || []).forEach((item) => {
          if (item !== panel) {
            item.open = false;
          }
        });
      });

      const summary = document.createElement('summary');
      Object.assign(summary.style, {
        listStyle: 'none',
        cursor: 'pointer',
        padding: '14px 18px',
      });

      const summaryGrid = document.createElement('div');
      Object.assign(summaryGrid.style, {
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        rowGap: '0',
        columnGap: '20px',
        alignItems: 'center',
      });

      const idLine = document.createElement('div');
      idLine.textContent = latest?.eggId ? `#${latest.eggId}` : 'No game id';
      Object.assign(idLine.style, {
        fontSize: 'clamp(12px, 2.8vw, 15px)',
        color: '#ffffff',
        fontWeight: '600',
        lineHeight: '1.3',
        wordBreak: 'break-word',
      });

      const summaryStatus = document.createElement('div');
      const summaryToken = statusStyle(latest);
      summaryStatus.textContent = statusLabel(latest);
      Object.assign(summaryStatus.style, {
        padding: '4px 20px',
        borderRadius: '999px',
        fontSize: '11px',
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        background: summaryToken.bg,
        color: summaryToken.color,
        border: '1px solid rgba(255, 213, 79, 0.2)',
        justifySelf: 'end',
      });

      summaryGrid.appendChild(idLine);
      summaryGrid.appendChild(summaryStatus);
      summary.appendChild(summaryGrid);
      panel.appendChild(summary);

      if (!entries.length) {
        panel.open = false;
        summary.style.cursor = 'default';
        this.modalBody.appendChild(panel);
        return;
      }

      const body = document.createElement('div');
      Object.assign(body.style, {
        padding: '0 14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxHeight: '240px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.72) rgba(255, 255, 255, 0.08)',
      });

      entries.forEach((entry, eventIndex) => {
        const eventRow = document.createElement('div');
        Object.assign(eventRow.style, {
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          paddingTop: eventIndex === 0 ? '2px' : '10px',
          borderTop: eventIndex === 0 ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
        });

        const topLine = document.createElement('div');
        Object.assign(topLine.style, {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        });

        const label = document.createElement('div');
        label.textContent = eventLabel(entry);
        Object.assign(label.style, {
          color: '#ffffff',
          fontWeight: '700',
        });

        const meta = document.createElement('div');
        Object.assign(meta.style, {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '4px',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        });

        const prizeAmount = typeof entry?.winAmount === 'number' ? entry.winAmount : 0;
        if (prizeAmount > 0 && (entry?.actionType === 'win' || entry?.actionType === 'redeemed')) {
          const prizeLine = document.createElement('div');
          prizeLine.textContent = `Prize ${this._formatMoney(prizeAmount)}`;
          Object.assign(prizeLine.style, {
            fontSize: '15px',
            color: 'rgb(32, 244, 12)',
            fontWeight: '700',
          });
          meta.appendChild(prizeLine);
        }

        const footer = document.createElement('div');
        Object.assign(footer.style, {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        });

        const when = document.createElement('div');
        when.textContent = entry.time instanceof Date ? entry.time.toLocaleString() : String(entry.time || '');
        Object.assign(when.style, {
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.72)',
        });

        const costLine = document.createElement('div');
        const shouldShowCost = !['stored', 'retrieve', 'redeemed'].includes(entry?.actionType);
        const costAmount = typeof entry?.betAmount === 'number'
          ? entry.betAmount
          : (typeof entry?.chargeAmount === 'number' ? entry.chargeAmount : 0);
        if (shouldShowCost && costAmount > 0) {
          costLine.textContent = `Cost ${this._formatMoney(costAmount)}`;
          Object.assign(costLine.style, {
            fontSize: '12px',
            color: 'rgba(255, 255, 255, 0.72)',
            fontWeight: '600',
          });
        }

        topLine.appendChild(label);
        topLine.appendChild(meta);
        eventRow.appendChild(topLine);
        footer.appendChild(when);
        if (shouldShowCost && costAmount > 0) {
          footer.appendChild(costLine);
        }
        eventRow.appendChild(footer);
        body.appendChild(eventRow);
      });

      panel.appendChild(body);
      this.modalBody.appendChild(panel);
    });
  }
  // endregion rendering ---------------------------------------------------------

  // region utils / visuals ------------------------------------------------------
  _createButton(label, onPress, options = {}) {
    const width = options.width ?? 220;
    const height = options.height ?? 64;
    const color = options.color ?? 0xd32f2f;
    const fontSize = options.fontSize ?? 18;
    const textOffsetY = options.textOffsetY ?? 0;
    const container = new Container();
    const bg = new Graphics();
    bg.beginFill(color);
    bg.drawRoundedRect(0, 0, width, height, 14);
    bg.endFill();
    const bgSprite = new Sprite();
    bgSprite.visible = false;
    bgSprite.width = width;
    bgSprite.height = height;
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
    text.position.set(width / 2, height / 2 + textOffsetY);

    container.addChild(bg, bgSprite, glow, text);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', onPress);
    container._labelText = text;
    container._labelOffsetY = textOffsetY;
    container._bgGraphics = bg;
    container._bgSprite = bgSprite;
    container._glow = glow;
    container._baseWidth = width;
    container._baseHeight = height;

    container.width = width;
    container.height = height;
    return container;
  }

  _drawBackdrop(width, height) {
    this.backdrop.clear();
    this.backdrop.removeChildren();

    const frame = new Graphics();
    frame.lineStyle(6, 0xffd54f, 1);
    frame.drawRoundedRect(10, 10, width - 20, height - 20, 18);
    this.backdrop.addChild(frame);
  }

  _drawEgg(centerX, centerY, eggWidth = 400, eggHeight = eggWidth) {

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
    const type = egg?.id === 'premium' ? 'premium' : 'normal';
    const safeLevel = Math.max(1, Math.min(level || 1, this.maxCracks));
    const normalCrackName = (lvl) => `gold-crack-${lvl}.png`;
    const normalFullName = (lvl) => `gold-${lvl}.png`;
    const premiumFullName = (lvl) => `diamond-${lvl}.png`;
    const premiumCrackName = (lvl) => `diamond-crack-${lvl}.png`;
    const fullName = type === 'premium' ? premiumFullName(safeLevel) : normalFullName(safeLevel);
    const crackName = type === 'premium' ? premiumCrackName(safeLevel) : normalCrackName(safeLevel);
    return {
      fullUrl: `/assets/${type}/full/${fullName}`,
      brokenUrl: `/assets/${type}/crack/${crackName}`,
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
      tryIndex: typeof egg?.tries === 'number' ? egg.tries : (typeof egg?.triesInSet === 'number' ? egg.triesInSet : null),
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
    const hideHome = tries > 0;
    const disableAlpha = 0.5;
    const disableMode = 'none';

    const setState = (btn, enabled) => {
      btn.alpha = enabled ? 1 : disableAlpha;
      btn.eventMode = enabled && !this.isLocked ? 'static' : disableMode;
    };

    setState(this.actionButton, canCrack);

    if (this.actionButton) this.actionButton.visible = !!egg;
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
    const playMetrics = this._getPlayMetrics(width, height);
    this._drawEgg(width / 2, playMetrics.eggCenterY, playMetrics.eggWidth, playMetrics.eggHeight);

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
    const actionH = this.actionButton._baseHeight ?? this.actionButton.height ?? 64;
    const marginBottom = 24;
    const fallbackRowY = Math.min(height * 0.82, height - actionH - marginBottom);
    const preferredRowY = this._playLayout?.actionButtonY;
    const rowY = Math.min(
      typeof preferredRowY === 'number' ? preferredRowY : fallbackRowY,
      height - actionH - marginBottom,
    );

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

  _getPlayMetrics(width, height) {
    const viewportWidth = window.innerWidth || width || 0;
    const viewportHeight = window.innerHeight || height || 0;
    const isMobile = viewportWidth <= 520;
    const isTablet = viewportWidth > 520 && viewportWidth <= 920;
    const isLargeDesktop = viewportWidth >= 1360 || viewportHeight >= 860;
    const actionH = this.actionButton?._baseHeight ?? this.actionButton?.height ?? 64;
    const marginBottom = isMobile ? 18 : 24;
    const hudBottom = isMobile ? 228 : isTablet ? 238 : isLargeDesktop ? 220 : 232;
    const topPadding = isMobile ? 10 : 14;
    const minEggSize = isMobile ? 220 : isTablet ? 260 : 300;
    const maxEggSize = isMobile ? 300 : 400;
    const labelGap = isMobile ? 14 : isTablet ? 18 : 22;
    const buttonGap = isMobile ? 18 : isTablet ? 22 : 26;
    const labelReserve = isMobile ? 30 : 34;
    const bottomLimit = height - actionH - marginBottom;
    const availableHeight = Math.max(
      220,
      bottomLimit - hudBottom - topPadding - labelGap - buttonGap - labelReserve,
    );
    const eggWidth = Math.max(
      minEggSize,
      Math.min(
        maxEggSize,
        width * (isMobile ? 0.42 : isTablet ? 0.38 : 0.32),
        availableHeight,
      ),
    );
    const eggHeight = eggWidth;
    const eggTop = hudBottom + topPadding;
    let eggCenterY = eggTop + eggHeight / 2;
    let labelY = eggTop + eggHeight + labelGap;
    let actionButtonY = labelY + buttonGap;

    const overflow = actionButtonY - bottomLimit;
    if (overflow > 0) {
      eggCenterY -= overflow;
      labelY -= overflow;
      actionButtonY -= overflow;
    }

    return {
      eggWidth,
      eggHeight,
      eggCenterY,
      labelY,
      actionButtonY: Math.min(actionButtonY, bottomLimit),
    };
  }
  // endregion helpers / state ---------------------------------------------------
}
