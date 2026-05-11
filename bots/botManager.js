import mineflayer from "mineflayer";

export const bots = {};
const creating = new Set();
export const manualDisconnects = new Set(); // manual disconnect emails

const pendingAuth = new Set(); // msa auth pending

function log(io, bot, type, message) {
    io.emit("log", { bot, type, message });
    console.log(`[${bot}] ${message}`);
}

export async function createBotInstance({ email, host, io }) {
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

        bot.once("login", () => {
            // login after msa, dismiss now
            if (pendingAuth.has(email)) {
                pendingAuth.delete(email);
                io.emit("authDone", { bot: email });
            }
        });

        bot.once("spawn", () => {
            mcName = bot.username;

            bots[mcName] = { bot, email, username: mcName };
            creating.delete(email);

            // dont show modal cuz its safe anyway
            if (pendingAuth.has(email)) {
                pendingAuth.delete(email);
                io.emit("authDone", { bot: email });
            }

            io.emit("botRegistered", { email, username: mcName });
            log(io, mcName, "success", "Spawned successfully");

            setTimeout(() => {
                bot.chat("/afk 10");
            }, 3000);
        });

        bot.on("message", (jsonMsg) => {
            const raw = jsonMsg.toMotd();
            const plain = jsonMsg.toString();

            //skip auth-related server chat lines onMsaCode etc
            if (
                plain.includes("First time signing in") ||
                plain.includes("Please authenticate") ||
                plain.match(/https:\/\/\S+microsoft\S+/i) ||
                plain.match(/use the code ([A-Z0-9]{8})/i) ||
                plain.includes("Signed in with Microsoft")
            ) return;

            log(io, mcName, "chat", raw);
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
            log(io, mcName, "error", `Error: ${err.message}`);
        });
    }

    connect();
}
