import fs from "fs";
import mineflayer from "mineflayer";

export const bots = {};
const creating = new Set();
export const manualDisconnects = new Set(); // manual disconnect emails

const pendingAuth = new Set(); // msa auth pending
const AUTH_FOLDER = "./auth";

function log(io, bot, type, message) {
    io.emit("log", { bot, type, message });
    const consoleMessage = String(message || "").replace(/§#?[0-9a-fA-F]{6}/g, "").replace(/§./g, "");
    console.log(`[${bot}] ${consoleMessage}`);
}

function purgeAuthCache() {
    try {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    } catch { }
}

export async function createBotInstance({ email, host, io, onChatMessage }) {
    if (creating.has(email)) return;
    creating.add(email);

    async function connect() {
        log(io, email, "info", `Connecting to ${host}:25565`);

        const bot = mineflayer.createBot({
            host,
            port: 25565,
            username: email,
            version: "1.21.4",
            auth: "microsoft",
            profilesFolder: "./auth",
            onMsaCode: (data) => {
                // fires for fresh msa needed
                pendingAuth.add(email);
                io.emit("authPrompt", {
                    bot: email,
                    url: data.verification_uri,
                    code: data.user_code,
                });
            },
        });

        let mcName = email;
        const recentChatFingerprints = new Map();

        bot.once("login", () => {
            // login after msa, dismiss now
            if (pendingAuth.has(email)) {
                pendingAuth.delete(email);
                io.emit("authDone", { bot: email });
            }
        });

        bot.once("spawn", () => {
            mcName = bot.username;

            bots[mcName] = { bot, email, username: mcName, startedAt: Date.now() };
            creating.delete(email);

            // dont show modal cuz its safe anyway
            if (pendingAuth.has(email)) {
                pendingAuth.delete(email);
                io.emit("authDone", { bot: email });
            }

            io.emit("botRegistered", { email, username: mcName });
            log(io, mcName, "success", "Spawned successfully");

            bot._client.on("open_window", (packet) => {
                console.log("RAW open_window packet:", JSON.stringify(packet));
            });
            bot.on("windowOpen", (w) => {
                console.log("windowOpen event:", w?.title, "slots:", w?.slots?.length);
            });

            setTimeout(() => {
                bot.chat("/afk 10");
            }, 3000);
        });

        const handleChat = (raw, plain) => {
            const fingerprint = `${String(raw ?? "")}\n${String(plain ?? "")}`;
            const now = Date.now();
            const lastSeen = recentChatFingerprints.get(fingerprint) || 0;
            if (now - lastSeen < 500) return;
            recentChatFingerprints.set(fingerprint, now);
            for (const [key, seenAt] of recentChatFingerprints) {
                if (now - seenAt > 5000) recentChatFingerprints.delete(key);
            }

            //skip auth-related server chat lines onMsaCode etc
            if (
                plain.includes("First time signing in") ||
                plain.includes("Please authenticate") ||
                plain.match(/https:\/\/\S+microsoft\S+/i) ||
                plain.match(/use the code ([A-Z0-9]{8})/i) ||
                plain.includes("Signed in with Microsoft")
            ) return;

            onChatMessage?.({ bot: mcName, raw, plain });
            log(io, mcName, "chat", raw);
        };

        bot.on("message", (jsonMsg) => {
            const raw = jsonMsg.toMotd();
            const plain = jsonMsg.toString();
            handleChat(raw, plain);
        });

        bot.on("end", () => {
            delete bots[mcName];
            if (manualDisconnects.has(email)) {
                manualDisconnects.delete(email);
                creating.delete(email);
                log(io, mcName, "disconnect", "Disconnected.");
                return;
            }
            log(io, mcName, "disconnect", "Disconnected. Reconnecting in 5s...");
            setTimeout(connect, 5000);
        });

        bot.on("error", (err) => {
            const message = err?.message || String(err);
            log(io, mcName, "error", `Error: ${message}`);

            if (/invalid_grant|token.*expired|grant is expired/i.test(message)) {
                log(io, mcName, "warn", "Auth token expired. Clearing cached auth and re-requesting login.");
                purgeAuthCache();
            }
        });
    }

    connect();
}
