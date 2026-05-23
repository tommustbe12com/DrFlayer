function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripMcFormatting(s) {
  return String(s ?? "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/\u00a7[0-9a-fk-or]/gi, "")
    .trim();
}

function includesText(hay, needle) {
  return stripMcFormatting(hay).toLowerCase().includes(String(needle).toLowerCase());
}

function windowTitleStr(title) {
  if (!title) return "";
  if (typeof title === "string") return stripMcFormatting(title);
  // json menus
  const raw = title?.value ?? title?.text ?? JSON.stringify(title);
  return stripMcFormatting(String(raw));
}

function itemName(item) {
  const displayName = item?.displayName || item?.name || "";
  return stripMcFormatting(displayName);
}

function itemLoreLines(item) {
  const out = [];
  try {
    const lore = item?.nbt?.value?.display?.value?.Lore?.value?.value;
    if (Array.isArray(lore)) {
      for (const line of lore) out.push(stripMcFormatting(line));
    }
  } catch {
    // nothin
  }
  return out;
}

function findSlot(window, predicate) {
  if (!window?.slots) return -1;
  for (let i = 0; i < window.slots.length; i++) {
    const item = window.slots[i];
    if (!item) continue;
    if (predicate(item, i)) return i;
  }
  return -1;
}

function windowTitleMatches(window, matchTitle) {
  return windowTitleStr(window?.title).toLowerCase().includes(matchTitle.toLowerCase());
}

function waitForWindowOpen(bot, { timeoutMs = 8000, ignoreCurrent = true } = {}) {
  return new Promise((resolve, reject) => {
    const alreadyOpen = bot.currentWindow;

    if (alreadyOpen && !ignoreCurrent) {
      return resolve(alreadyOpen);
    }

    const start = Date.now();
    let settled = false;

    function settle(result) {
      if (settled) return;
      settled = true;
      clearInterval(pollInterval);
      clearTimeout(timeout);
      bot.removeListener("windowOpen", onOpen);
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    function onOpen(w) {
      if (ignoreCurrent && w === alreadyOpen) return;
      settle(w);
    }

    const pollInterval = setInterval(() => {
      const w = bot.currentWindow;
      if (w && w !== alreadyOpen) settle(w);
      if (Date.now() - start > timeoutMs) settle(new Error("Timed out waiting for windowOpen"));
    }, 100);

    const timeout = setTimeout(() => {
      settle(new Error("Timed out waiting for windowOpen"));
    }, timeoutMs);

    bot.on("windowOpen", onOpen);
  });
}

async function waitForWindowMatch(bot, matchTitle, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;

  const cur = bot.currentWindow;
  if (cur && windowTitleMatches(cur, matchTitle)) return cur;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const w = await waitForWindowOpen(bot, { timeoutMs: remaining, ignoreCurrent: true });

    if (windowTitleMatches(w, matchTitle)) return w;
    // wrong
  }

  throw new Error(`Timed out waiting for window matching "${matchTitle}"`);
}

async function clickSlot(bot, _window, slot, delayMs = 300) {
  await bot.clickWindow(slot, 0, 0);
  await wait(delayMs);
}

function safeCloseWindow(bot) {
  try {
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  } catch {
    try { bot.closeWindow(); } catch { /* ignore */ }
  }
}

export async function buySkellyOnce({
  bot,
  log,
  // s is stupid cyrillic cuz donut is stuhpid
  shopTitle = "ѕʜᴏᴘ",
  shardShopItemText = "ѕʜᴀʀᴅ ѕʜᴏᴘ",
  shardShopItemType = "amethyst_shard",
  shardShopTitle = "ѕʜᴏᴘ - ѕʜᴀʀᴅ ѕʜᴏᴘ",
  spawnerItemText = "Spawner",
  spawnerLoreMustContain = "Skeleton",
  confirmItemText = "ᴄᴏɴꜰɪʀᴍ",
  confirmItemType = "lime_stained_glass_pane",
}) {
  safeCloseWindow(bot); // 15, 13, then 15 for slotsssssss
  await wait(300);

  bot.chat("/shop");
  await wait(500);

  log?.("info", "Waiting for shop window...");
  const shopWindow = await waitForWindowMatch(bot, shopTitle, 12_000);
  await wait(300);

  log?.("info", `Shop window open: "${windowTitleStr(shopWindow.title)}"`);

  const shardSlot = findSlot(shopWindow, (item) => {
    if (shardShopItemType) return item.name === shardShopItemType;
    return includesText(itemName(item), shardShopItemText);
  });
  if (shardSlot < 0) {
    safeCloseWindow(bot);
    throw new Error("Could not find shard shop item in /shop GUI");
  }

  log?.("info", `Clicking shard shop at slot ${shardSlot}`);
  await clickSlot(bot, shopWindow, shardSlot, 400);

  log?.("info", "Waiting for shard shop window...");
  const shardWindow = await waitForWindowMatch(bot, shardShopTitle, 12_000);
  await wait(300);

  log?.("info", `Shard shop window open: "${windowTitleStr(shardWindow.title)}"`);

  const spawnerSlot = 13;
  // if (spawnerSlot < 0) {
  //   safeCloseWindow(bot);
  //   throw new Error("Could not find Skeleton spawner item");
  // }

  log?.("info", `Clicking skeleton spawner at slot ${spawnerSlot}`);
  await clickSlot(bot, shardWindow, spawnerSlot, 500);

  let confirmWindow = bot.currentWindow;

  const confirmInCurrent =
    confirmWindow &&
    findSlot(confirmWindow, (item) => {
      if (confirmItemType && item.name !== confirmItemType) return false;
      return includesText(itemName(item), confirmItemText);
    }) >= 0;

  if (!confirmInCurrent) {
    log?.("info", "Waiting for confirm window...");
    confirmWindow = await waitForWindowOpen(bot, { timeoutMs: 6_000, ignoreCurrent: false });
    await wait(300);
  }

  const confirmSlot = 15;
  // if (confirmSlot < 0) {
  //   safeCloseWindow(bot);
  //   throw new Error("Could not find Confirm button");
  // }

  log?.("info", `Clicking confirm at slot ${confirmSlot}`);
  await clickSlot(bot, confirmWindow, confirmSlot, 400);

  safeCloseWindow(bot);
  log?.("success", "Skelly buy sequence complete.");
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
}) {
  const state = new Map();

  async function runForBot(name, entry) {
    let s = state.get(name);
    if (!s) {
      s = { running: false, lastBuyAt: 0, lastSeenShards: 0 };
      state.set(name, s);
    }

    const settings = getSettings();
    if (!settings?.autoSkelly?.enabled) return;
    if (!entry?.bot) return;
    if (s.running) return;

    let stats;
    try {
      stats = await fetchStats(name);
    } catch (e) {
      log?.(name, "error", `Auto-Skelly: fetchStats failed: ${e?.message || e}`);
      return;
    }

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

      if (settings?.autoSkelly?.alertEnabled) {
        notify?.({ kind: "skelly_threshold", bot: name, shards });
      }

      await buySkellyOnce({
        bot: entry.bot,
        log: (type, message) => log?.(name, type, message),
      });

      s.lastBuyAt = Date.now();
      notify?.({ kind: "skelly_buy", bot: name, shards });
      log?.(name, "success", "Auto-Skelly purchase completed.");
    } catch (e) {
      log?.(name, "error", `Auto-Skelly failed: ${e?.message || e}`);
    } finally {
      s.running = false;
    }
  }

  const timer = setInterval(async () => {
    for (const [name, entry] of Object.entries(bots)) {
      await runForBot(name, entry);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}