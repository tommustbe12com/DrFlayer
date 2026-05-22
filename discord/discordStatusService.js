import fs from "fs";
import path from "path";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const DEFAULT_UPDATE_MS = 10_000;
const DEFAULT_STATS_TTL_MS = 60_000;

function fmt(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, "") + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.?0+$/, "") + "K";
  return n.toLocaleString();
}

function fmtTime(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function fmtDurationMs(ms) {
  ms = Math.max(0, Math.floor(Number(ms) || 0));
  return fmtTime(ms / 1000);
}

function safeOneLine(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/`/g, "ˋ")
    .trim();
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function startDiscordStatusService({
  bots,
  getRecentLogs,
  fetchStats,
  token,
  channelId,
  messageId,
  storagePath = "./.data/discord-status.json",
  updateEveryMs = DEFAULT_UPDATE_MS,
  statsTtlMs = DEFAULT_STATS_TTL_MS,
}) {
  token = token ?? process.env.DISCORD_TOKEN;
  channelId = channelId ?? process.env.DISCORD_STATUS_CHANNEL_ID;
  messageId = messageId ?? process.env.DISCORD_STATUS_MESSAGE_ID;

  if (!token || !channelId) {
    return {
      stop: async () => {},
      reason: "DISCORD_TOKEN or DISCORD_STATUS_CHANNEL_ID not set",
    };
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const statsCache = new Map(); // username -> { at, data }
  async function getStatsCached(username) {
    const now = Date.now();
    const cached = statsCache.get(username);
    if (cached && now - cached.at < statsTtlMs) return cached.data;
    const data = await fetchStats(username);
    if (data) statsCache.set(username, { at: now, data });
    return data;
  }

  let timer = null;
  let lastMessageId = messageId || null;

  async function ensureMessage(channel) {
    if (!lastMessageId) {
      const persisted = readJson(storagePath);
      if (persisted?.messageId) lastMessageId = persisted.messageId;
    }

    if (lastMessageId) {
      try {
        const msg = await channel.messages.fetch(lastMessageId);
        return msg;
      } catch {
        lastMessageId = null;
      }
    }

    const msg = await channel.send({ embeds: [new EmbedBuilder().setTitle("Starting…")] });
    lastMessageId = msg.id;
    writeJsonAtomic(storagePath, { channelId, messageId: lastMessageId, updatedAt: new Date().toISOString() });
    return msg;
  }

  async function buildEmbed() {
    const now = Date.now();
    const entries = Object.entries(bots);

    const perBot = [];
    let totalShards = 0;
    let totalPlaytime = 0;

    for (const [name, entry] of entries) {
      const stats = await getStatsCached(name);
      const shards = Number(stats?.shards ?? 0) || 0;
      const playtime = Number(stats?.playtime ?? 0) || 0;
      totalShards += shards;
      totalPlaytime += playtime;

      const uptime = entry?.startedAt ? fmtDurationMs(now - entry.startedAt) : "—";
      const status = entry?.bot ? "Online" : "—";

      perBot.push({
        name,
        status,
        uptime,
        shards,
        money: Number(stats?.money ?? 0) || 0,
        playtime,
      });
    }

    perBot.sort((a, b) => b.shards - a.shards || a.name.localeCompare(b.name));

    const lines = perBot.slice(0, 20).map((b) => {
      return `• **${safeOneLine(b.name)}** — ${b.status} | Uptime: ${b.uptime} | Shards: ${fmt(b.shards)} | Playtime: ${fmtTime(
        b.playtime
      )}`;
    });

    if (perBot.length > 20) lines.push(`• …and ${perBot.length - 20} more`);

    const logs = (getRecentLogs?.(8) ?? []).slice(-8);
    const logLines =
      logs.length === 0
        ? ["(none yet)"]
        : logs.map((l) => `• [${safeOneLine(l.bot)}] ${safeOneLine(l.type)}: ${safeOneLine(l.message)}`.slice(0, 240));

    const embed = new EmbedBuilder()
      .setTitle("Mineflayer Bot Status")
      .setColor(0x2b90d9)
      .setDescription(lines.join("\n") || "(no bots connected)")
      .addFields(
        { name: "Summary", value: `Bots: **${entries.length}**\nTotal shards: **${fmt(totalShards)}**\nTotal playtime: **${fmtTime(totalPlaytime)}**`, inline: true },
        { name: "Recent logs", value: logLines.join("\n").slice(0, 1024), inline: false }
      )
      .setFooter({ text: `Updates every ${Math.round(updateEveryMs / 1000)}s` })
      .setTimestamp(new Date());

    return embed;
  }

  async function tick() {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !("send" in channel)) return;

      const msg = await ensureMessage(channel);
      const embed = await buildEmbed();
      await msg.edit({ embeds: [embed] });

      writeJsonAtomic(storagePath, { channelId, messageId: lastMessageId, updatedAt: new Date().toISOString() });
    } catch {
      // keep running; next tick may recover
    }
  }

  client.once("ready", async () => {
    await tick();
    timer = setInterval(tick, updateEveryMs);
  });

  client.login(token);

  return {
    stop: async () => {
      if (timer) clearInterval(timer);
      await client.destroy();
    },
    getMessageId: () => lastMessageId,
  };
}
