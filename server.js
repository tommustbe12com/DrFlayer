import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createBotInstance, bots, manualDisconnects } from "./bots/botManager.js";
import debug from "debug";
import { startDiscordStatusService } from "./discord/discordStatusService.js";
import fs from "fs";
import path from "path";
import { startAutoSkelly } from "./bots/autoSkelly.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const API_KEY = process.env.DONUTSMP_API_KEY || "asdfasdf"; // optional api key from /api in the donut smp server

// log hist
const LOG_LIMIT = 500;
const logHistory = { _master: [] }; // keyed by botName, _master = all

function pushLog(data) {
    // master
    logHistory._master.push(data);
    if (logHistory._master.length > LOG_LIMIT) logHistory._master.shift();
    // per bot
    if (!logHistory[data.bot]) logHistory[data.bot] = [];
    logHistory[data.bot].push(data);
    if (logHistory[data.bot].length > LOG_LIMIT) logHistory[data.bot].shift();
}

// patch io emit
const _origEmit = io.emit.bind(io);
io.emit = (event, ...args) => {
    if (event === "log") pushLog(args[0]);
    return _origEmit(event, ...args);
};

function getRecentLogs(limit = 8) {
    return logHistory._master.slice(-Math.max(0, Math.min(LOG_LIMIT, limit)));
}

async function fetchDonutStats(username) {
    try {
        const response = await fetch(`https://api.donutsmp.net/v1/stats/${username}`, {
            headers: { Authorization: `Bearer ${API_KEY}` },
        });
        const data = await response.json();
        return data?.result ?? null;
    } catch {
        return null;
    }
}

const SETTINGS_PATH = "./.data/settings.json";
function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    } catch {
        return {
            discord: { enabled: false, token: "", channelId: "", messageId: "", updateEveryMs: 10000, keepAtBottom: false },
            autoSkelly: { enabled: false, alertEnabled: false, mentionIds: "", alertChannelId: "" },
        };
    }
}

function writeSettings(settings) {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

app.use(express.static("public"));
app.use(express.json());

process.env.DEBUG = "";
debug.disable("*");

["log", "warn", "error"].forEach((method) => {
    const original = console[method];
    console[method] = (...args) => {
        const msg = args.join(" ");
        if (
            msg.includes("Chunk size is") ||
            msg.includes("partial packet") ||
            msg.includes("player_info") ||
            msg.includes("minecraft-protocol")
        ) return;
        original(...args);
    };
});

// proxy stats (optional)
app.get("/api/stats/:username", async (req, res) => {
    try {
        const result = await fetchDonutStats(req.params.username);
        res.json({ result });
    } catch (err) {
        console.error("Stats proxy error:", err.cause ?? err);
        res.status(500).json({ error: err.message });
    }
});

// discord config (local dashboard convenience; do not expose publicly)
app.get("/api/settings", (req, res) => {
    const settings = readSettings();
    res.json({
        discord: {
            enabled: Boolean(settings.discord?.enabled),
            channelId: settings.discord?.channelId || "",
            messageId: settings.discord?.messageId || "",
            updateEveryMs: settings.discord?.updateEveryMs || 10000,
            keepAtBottom: Boolean(settings.discord?.keepAtBottom),
            token: settings.discord?.token ? "********" : "",
        },
        autoSkelly: {
            enabled: Boolean(settings.autoSkelly?.enabled),
            alertEnabled: Boolean(settings.autoSkelly?.alertEnabled),
            mentionIds: settings.autoSkelly?.mentionIds || "",
            alertChannelId: settings.autoSkelly?.alertChannelId || "",
        },
    });
});

let discordService = null;
let currentSettings = null;
function getSettingsCached() {
    if (!currentSettings) currentSettings = readSettings();
    return currentSettings;
}
function setSettingsCached(s) {
    currentSettings = s;
}
function startDiscordFromConfig() {
    const settings = getSettingsCached();
    const cfg = settings.discord;
    if (!cfg?.enabled) return;

    discordService = startDiscordStatusService({
        bots,
        getRecentLogs,
        fetchStats: fetchDonutStats,
        token: cfg.token,
        channelId: cfg.channelId,
        messageId: cfg.messageId,
        updateEveryMs: cfg.updateEveryMs || 10000,
        keepAtBottom: Boolean(cfg.keepAtBottom),
    });
}

async function restartDiscordFromConfig() {
    try { await discordService?.stop?.(); } catch { }
    discordService = null;
    startDiscordFromConfig();
}

app.post("/api/settings", async (req, res) => {
    const existing = readSettings();
    const body = req.body || {};

    const discordExisting = existing.discord || {};
    const discordBody = body.discord || {};

    const discordToken =
        typeof discordBody.token === "string" && discordBody.token.trim().length
            ? discordBody.token.trim()
            : discordExisting.token;

    const discord = {
        enabled: Boolean(discordBody.enabled),
        channelId: String(discordBody.channelId || "").trim(),
        messageId: String(discordBody.messageId || "").trim(),
        token: discordToken || "",
        updateEveryMs: 10000,
        keepAtBottom: Boolean(discordBody.keepAtBottom),
    };

    const skellyExisting = existing.autoSkelly || {};
    const skellyBody = body.autoSkelly || {};
    const autoSkelly = {
        enabled: Boolean(skellyBody.enabled),
        alertEnabled: Boolean(skellyBody.alertEnabled),
        mentionIds: String(skellyBody.mentionIds || "").trim(),
        alertChannelId: String(skellyBody.alertChannelId || "").trim(),
    };

    const next = { discord, autoSkelly };
    writeSettings(next);
    setSettingsCached(next);
    await restartDiscordFromConfig();

    res.json({ ok: true });
});

//socket.io
io.on("connection", (socket) => {
    // list of active bnots to send tabs
    const activeBots = Object.entries(bots).map(([username, entry]) => ({
        username,
        email: entry.email,
    }));
    socket.emit("activeBots", activeBots);

    // replay
    for (const entry of logHistory._master) {
        socket.emit("log", entry);
    }

    socket.on("createBot", async ({ username, host }) => {
        if (!username || !host) return;
        await createBotInstance({ email: username, host, io });
    });

    socket.on("sendCommand", ({ botName, command }) => {
        const entry = bots[botName];
        if (!entry) return;
        try {
            entry.bot.chat(command);
            io.emit("log", { bot: botName, type: "command", message: command });
        } catch (err) {
            io.emit("log", { bot: botName, type: "error", message: err.message });
        }
    });

    socket.on("disconnectBot", (botName) => {
        let entry = bots[botName];
        let key = botName;

        if (!entry) {
            const found = Object.entries(bots).find(([, e]) => e.email === botName);
            if (found) { [key, entry] = found; }
        }

        if (!entry) return;

        // Mark as manual so that reconnect loop skips it
        manualDisconnects.add(entry.email);

        try { entry.bot.quit(); } catch { }
        delete bots[key];
    });

    socket.on("broadcastCommand", ({ command }) => {
        for (const [name, entry] of Object.entries(bots)) {
            try {
                entry.bot.chat(command);
                io.emit("log", { bot: name, type: "command", message: command });
            } catch (err) {
                io.emit("log", { bot: name, type: "error", message: err.message });
            }
        }
    });
});

server.listen(3000, () => {
    console.log("Dashboard running on http://localhost:3000");
});

// discord status (optional)
startDiscordFromConfig();

function formatMentions(raw) {
    const ids = String(raw || "")
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
    const parts = [];
    for (const id of ids) {
        if (id.startsWith("<@") && id.endsWith(">")) { parts.push(id); continue; }
        if (/^\d{15,22}$/.test(id)) parts.push(`<@${id}>`);
        else if (/^@&\d{15,22}$/.test(id)) parts.push(`<@&${id.slice(2)}>`);
        else if (/^@?\d{15,22}$/.test(id)) parts.push(`<@${id.replace(/^@/, "")}>`);
    }
    return parts.join(" ");
}

// Auto-buy skelly loop (optional)
startAutoSkelly({
    bots,
    fetchStats: fetchDonutStats,
    getSettings: getSettingsCached,
    log: (bot, type, message) => io.emit("log", { bot, type, message }),
    notify: async ({ kind, bot, shards }) => {
        const settings = getSettingsCached();
        const alertChannelId = settings?.autoSkelly?.alertChannelId || settings?.discord?.channelId;
        const mentionText = settings?.autoSkelly?.mentionIds ? formatMentions(settings.autoSkelly.mentionIds) : "";
        const header =
            kind === "skelly_threshold"
                ? "⚠️ **Skelly ready**"
                : "✅ **Skelly bought**";
        const content = `${mentionText ? mentionText + " " : ""}${header} — **${bot}** (shards: **${Math.floor(shards)}**)`;
        try {
            await discordService?.send?.({ channelId: alertChannelId, content });
        } catch { }
    },
});
