import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createBotInstance, bots, manualDisconnects } from "./bots/botManager.js";
import debug from "debug";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const API_KEY = "asdfasdf"; // optional api key from /api in the donut smp server

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
        const response = await fetch(`https://api.donutsmp.net/v1/stats/${req.params.username}`, {
            headers: { Authorization: `Bearer ${API_KEY}` },
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error("Stats proxy error:", err.cause ?? err);
        res.status(500).json({ error: err.message });
    }
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
