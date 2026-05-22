function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForWindowOpen(bot, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for windowOpen"));
    }, timeoutMs);

    function onOpen(window) {
      cleanup();
      resolve(window);
    }

    function cleanup() {
      clearTimeout(t);
      bot.removeListener("windowOpen", onOpen);
    }

    bot.once("windowOpen", onOpen);
  });
}

export function startAutoSkelly({
  bots,
  fetchStats,
  getSettings,
  log,
  notify,
  intervalMs = 30_000,
  shardThreshold = 1500,
  cooldownMs = 5 * 60_000,
  firstClickSlot = 15, // 16th item (0-based)
  secondClickSlot = 13, // 14th item (0-based)
}) {
  const state = new Map(); // botName -> { running, lastBuyAt, lastSeenShards }

  async function runForBot(name, entry) {
    const s = state.get(name) || { running: false, lastBuyAt: 0, lastSeenShards: 0 };
    state.set(name, s);

    const settings = getSettings();
    const enabled = Boolean(settings?.autoSkelly?.enabled);
    if (!enabled) return;

    if (!entry?.bot) return;
    if (s.running) return;

    const stats = await fetchStats(name);
    const shards = Number(stats?.shards ?? 0) || 0;
    const now = Date.now();

    const canTrigger =
      shards >= shardThreshold &&
      (s.lastSeenShards < shardThreshold || now - s.lastBuyAt > cooldownMs);

    s.lastSeenShards = shards;
    if (!canTrigger) return;

    s.running = true;
    try {
      log?.(name, "info", `Auto-Skelly triggered at ${shards} shards.`);
      const alertEnabled = Boolean(settings?.autoSkelly?.alertEnabled);
      if (alertEnabled) {
        notify?.({ kind: "skelly_threshold", bot: name, shards });
      }

      entry.bot.chat("/shop");
      const window = await waitForWindowOpen(entry.bot, 10_000);

      await wait(600);
      await entry.bot.clickWindow(firstClickSlot, 0, 0);
      await wait(800);
      await entry.bot.clickWindow(secondClickSlot, 0, 0);
      await wait(800);

      try {
        entry.bot.closeWindow(window);
      } catch {
        try { entry.bot.closeWindow(); } catch { }
      }

      s.lastBuyAt = Date.now();

      notify?.({ kind: "skelly_buy", bot: name, shards });

      log?.(name, "success", "Auto-Skelly purchase sequence completed.");
    } catch (e) {
      log?.(name, "error", `Auto-Skelly failed: ${e?.message || e}`);
    } finally {
      s.running = false;
    }
  }

  const timer = setInterval(async () => {
    const entries = Object.entries(bots);
    for (const [name, entry] of entries) {
      await runForBot(name, entry);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
