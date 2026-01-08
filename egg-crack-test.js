import * as PIXI from "https://cdn.jsdelivr.net/npm/pixi.js@8.4.0/dist/pixi.min.mjs";

const app = new PIXI.Application();
await app.init({
  backgroundAlpha: 0,
  resizeTo: window,
  antialias: true,
});
document.body.appendChild(app.canvas);

// 你的图片路径（换成你的）
const FULL_EGG_URL = "/assets/egg.png";
const BROKEN_EGG_URL = "/assets/egg_broken.png";

let assets;
try {
  assets = await PIXI.Assets.load([FULL_EGG_URL, BROKEN_EGG_URL]);
} catch (err) {
  const msg = document.createElement("div");
  msg.style.position = "fixed";
  msg.style.left = "20px";
  msg.style.top = "20px";
  msg.style.color = "#ffd54f";
  msg.style.font = "16px/1.4 Segoe UI, Arial, sans-serif";
  msg.textContent = `Asset load failed: ${err?.message || err}`;
  document.body.appendChild(msg);
  throw err;
}

// 容器：方便整体做抖动/缩放
const eggContainer = new PIXI.Container();
app.stage.addChild(eggContainer);
eggContainer.x = app.screen.width / 2;
eggContainer.y = app.screen.height / 2;

// 完整蛋
const fullEgg = new PIXI.Sprite(assets[FULL_EGG_URL]);
fullEgg.anchor.set(0.5);
fullEgg.scale.set(0.6);
eggContainer.addChild(fullEgg);

// 破蛋（先隐藏）
const brokenEgg = new PIXI.Sprite(assets[BROKEN_EGG_URL]);
brokenEgg.anchor.set(0.5);
brokenEgg.scale.set(0.6);
brokenEgg.alpha = 0;
eggContainer.addChild(brokenEgg);

// 点击区域（也可以绑在 fullEgg 上）
eggContainer.eventMode = "static";
eggContainer.cursor = "pointer";

let isBroken = false;
let isAnimating = false;

// 简单 tween 工具（不用额外库）
function tween(durationMs, onUpdate, onComplete) {
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      const t = Math.min(1, (now - start) / durationMs);
      onUpdate(t);
      if (t < 1) requestAnimationFrame(tick);
      else {
        onComplete?.();
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

// 缓动
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// 生成碎片（不需要额外素材）
function spawnShards() {
  const shardContainer = new PIXI.Container();
  eggContainer.addChild(shardContainer);

  const shards = [];
  const count = 10;

  for (let i = 0; i < count; i += 1) {
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.9);
    // 小三角形碎片
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

  // 用 ticker 做物理飞散
  const tickerFn = () => {
    for (const s of shards) {
      s.g.x += s.vx;
      s.g.y += s.vy;
      s.vy += 0.35; // 重力
      s.g.rotation += s.vr;
      s.life -= 1;
      s.g.alpha = Math.max(0, s.life / 80);
    }
    // 清理
    if (shards.every((s) => s.life <= 0)) {
      app.ticker.remove(tickerFn);
      shardContainer.destroy({ children: true });
    }
  };
  app.ticker.add(tickerFn);
}

// 敲击动画：抖动 + 轻微缩放
async function knockAnim() {
  const baseScale = eggContainer.scale.x;
  const baseRot = eggContainer.rotation;

  // 轻微压缩
  await tween(120, (t) => {
    const e = easeOutCubic(t);
    eggContainer.scale.set(baseScale * (1 - 0.05 * e), baseScale * (1 + 0.03 * e));
    eggContainer.rotation = baseRot + Math.sin(e * Math.PI) * 0.05;
  });

  // 抖动（快速左右）
  const shakes = 10;
  for (let i = 0; i < shakes; i += 1) {
    eggContainer.x = app.screen.width / 2 + (i % 2 === 0 ? -6 : 6);
    await new Promise((r) => setTimeout(r, 20));
  }
  eggContainer.x = app.screen.width / 2;

  // 回弹复位
  await tween(120, (t) => {
    const e = easeOutCubic(t);
    eggContainer.scale.set(baseScale * (0.95 + 0.05 * e), baseScale * (1.03 - 0.03 * e));
    eggContainer.rotation = baseRot * (1 - e);
  });

  eggContainer.scale.set(baseScale);
  eggContainer.rotation = baseRot;
}

// 裂开：完整蛋淡出 + 破蛋淡入 + 碎片
async function breakAnim() {
  spawnShards();

  await tween(220, (t) => {
    const e = easeOutCubic(t);
    fullEgg.alpha = 1 - e;
    brokenEgg.alpha = e;
  });

  fullEgg.alpha = 0;
  brokenEgg.alpha = 1;
  isBroken = true;
}

eggContainer.on("pointertap", async () => {
  if (isAnimating) return;
  isAnimating = true;

  // 已经破了就只做敲击反馈
  if (isBroken) {
    await knockAnim();
    isAnimating = false;
    return;
  }

  await knockAnim();
  await breakAnim();

  isAnimating = false;
});

// 窗口变化时保持居中
window.addEventListener("resize", () => {
  eggContainer.x = app.screen.width / 2;
  eggContainer.y = app.screen.height / 2;
});
