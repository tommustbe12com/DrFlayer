const socket = io();

const botsDiv = document.getElementById("bots");
const botElements = {};   // key, { panel, logsEl, scoreboardEl }
let currentTab = "master";

window.createBot = createBot;
window.switchTab = switchTab;
window.searchPlayer = searchPlayer;
window.broadcastCommand = broadcastCommand;
window._statIntervals = {};

// mc color code parser (tommustbe12.com/mccolor.html
const MC_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
  'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF',
};
const MC_FORMATS = {
  'l': 'font-weight:bold',
  'o': 'font-style:italic',
  'n': 'text-decoration:underline',
  'm': 'text-decoration:line-through',
};

// format like donut smp
function fmt(n) {
  n = Number(n);
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.?0+$/, '') + 'K';
  return n.toLocaleString();
}

function fmtCommas(n) {
  return Number(n).toLocaleString();
}

function fmtTime(seconds) {
  seconds = Math.floor(Number(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function mcTextToHtml(text) {
    let html = '';
    let color = '';
    let formats = [];
    let i = 0;

    while (i < text.length) {
        if (text[i] === '§') { // section sign format
            const code = text[i + 1];
            if (!code) { i++; continue; }

            if (code === '#' && /^[0-9a-fA-F]{6}$/.test(text.slice(i + 2, i + 8))) {
                color = '#' + text.slice(i + 2, i + 8);
                formats = [];
                i += 8;
            } else {
                const c = code.toLowerCase();
                if (c === 'r') { color = ''; formats = []; }
                else if (MC_COLORS[c]) { color = MC_COLORS[c]; formats = []; }
                else if (MC_FORMATS[c]) { formats.push(MC_FORMATS[c]); }
                i += 2;
            }
        } else {
            let chunk = '';
            while (i < text.length && text[i] !== '§') {
                chunk += text[i++];
            }
            if (chunk) { // sometimes they use like custom formatting or smth
                const styles = [...(color ? [`color:${color}`] : []), ...formats].join(';');
                const escaped = chunk.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                html += styles ? `<span style="${styles}">${escaped}</span>` : escaped;
            }
        }
    }
    return html;
}

// acc tabs
function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

function addTab(name) {
  const bar = document.querySelector('.tabs-bar');
  if (bar.querySelector(`[data-tab="${name}"]`)) return;

  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.dataset.tab = name;
  btn.innerHTML = `<img class="tab-head" src="https://mc-heads.net/avatar/${name}/16" alt=""> ${name}`;
  btn.onclick = () => switchTab(name);
  bar.appendChild(btn);
}

// logssssssss
function appendLog(logsEl, data) {
  const div = document.createElement('div');
  div.className = data.type;
  const prefix = document.createElement('span');
  prefix.className = 'log-prefix';
  prefix.textContent = `[${data.bot}] `;
  div.appendChild(prefix);
  const msg = document.createElement('span');
  msg.innerHTML = mcTextToHtml(data.message);
  div.appendChild(msg);
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

// reconnect
const activeBotNames = new Set(); // list of the usernames and emails

socket.on("activeBots", (activeBots) => {
  for (const { username, email } of activeBots) {
    activeBotNames.add(username);
    activeBotNames.add(email);

    ensureUI(username);
    if (email !== username) {
      botElements[email] = botElements[username];
    }

    if (!window._statIntervals[username]) {
      fetchStats(username, botElements[username]?.scoreboardEl);
      window._statIntervals[username] = setInterval(
        () => fetchStats(username, botElements[username]?.scoreboardEl),
        60000
      );
    }
  }
});

socket.on("log", (data) => {
  // put on the master log
  appendLog(document.getElementById('master-logs'), data);

  // inactive no logs only active
  if (!botElements[data.bot]) {
    if (!activeBotNames.has(data.bot)) return;
    createBotUI(data.bot);
  }

  appendLog(botElements[data.bot].logsEl, data);
});

// auth modal
socket.on("authPrompt", ({ bot, url, code }) => {
    document.getElementById('auth-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'auth-modal';
    overlay.dataset.bot = bot; // store so authDone can get it and stuff
    overlay.innerHTML = `
        <div class="auth-box">
            <div class="auth-title">Sign in required</div>
            <div class="auth-bot">Bot: <strong>${bot}</strong></div>
            <div class="auth-steps">
                <div class="auth-step">1. Go to <a href="${url}" target="_blank">microsoft.com/link</a></div>
                <div class="auth-step">2. Enter this code:</div>
                <div class="auth-code">${code}</div>
                <button class="auth-copy" onclick="navigator.clipboard.writeText('${code}')">Copy code</button>
            </div>
            <div class="auth-waiting">
                <div class="auth-spinner"></div>
                Waiting for sign-in...
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
});

socket.on("authDone", ({ bot }) => {
    // modal
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    // dismiss if finisheeedddddddd
    if (modal.dataset.bot !== bot) return;

    const box = modal.querySelector('.auth-box');
    box.innerHTML = `
        <div class="auth-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="9 12 11 14 15 10"/>
            </svg>
            <span>Signed in as <strong>${bot}</strong></span>
        </div>
    `;

    setTimeout(() => modal.remove(), 2000);
});

// registered bot actions
socket.on("botRegistered", ({ email, username }) => {
  if (email === username) return;
  renameBotUI(email, username);
});

function renameBotUI(email, username) {
  if (email === username) return;
  if (botElements[username] && botElements[email] === botElements[username]) {
    return;
  }
  if (!botElements[email]) return;
  if (botElements[username] && botElements[username] !== botElements[email]) return; // alr real separate entry

  const entry = botElements[email];
  botElements[username] = entry;
  delete botElements[email];

  entry.panel.id = `tab-${username}`;
  entry.panel.querySelector('.bot-name').textContent = username;
  entry.panel.querySelector('.bot-head').src = `https://mc-heads.net/avatar/${username}/32`;

  const oldTab = document.querySelector(`.tab[data-tab="${email}"]`);
  if (oldTab) {
    oldTab.dataset.tab = username;
    oldTab.innerHTML = `<img class="tab-head" src="https://mc-heads.net/avatar/${username}/16" alt=""> ${username}`;
    oldTab.onclick = () => switchTab(username);
    if (currentTab === email) switchTab(username);
  }

  entry.sendBtn.onclick = () => {
    socket.emit("sendCommand", { botName: username, command: entry.cmdInput.value });
  };

  if (window._statIntervals[email]) {
    clearInterval(window._statIntervals[email]);
    delete window._statIntervals[email];
  }
  if (!window._statIntervals[username]) {
    fetchStats(username, entry.scoreboardEl);
    window._statIntervals[username] = setInterval(() => fetchStats(username, entry.scoreboardEl), 60000);
  }

  updateSavedUsername(email, username);
}

function showLimitModal(onConfirm) {
  document.getElementById('limit-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'limit-modal';
  overlay.innerHTML = `
    <div class="limit-box">
      <div class="limit-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      </div>
      <div class="limit-title">Account Limit Reached</div>
      <div class="limit-body">
        Donut SMP and most servers allow a maximum of <strong>5 accounts per IP</strong>.
        You already have 5 bots running! Adding another will 99% likely not work and could get your IP flagged or banned.
      </div>
      <div class="limit-actions">
        <button class="limit-btn-no">No, go back</button>
        <button class="limit-btn-yes">Yes, start this bot</button>
      </div>
    </div>
  `;

  overlay.querySelector('.limit-btn-no').onclick = () => overlay.remove();
  overlay.querySelector('.limit-btn-yes').onclick = () => {
    overlay.remove();
    onConfirm();
  };

  // click outside to cancel
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  document.body.appendChild(overlay);
}

// create it!
function createBot() {
  const username = document.getElementById("username").value.trim();
  const host = document.getElementById("host").value.trim();
  if (!username || !host) return;

  const doCreate = () => {
    socket.emit("createBot", { username, host });
    ensureUI(username);
    saveBot(username, host);
    renderSavedBots();
  };

  // unique
  const activeCount = new Set(Object.values(botElements).map(e => e.panel)).size;

  if (activeCount >= 5) {
    showLimitModal(doCreate);
  } else {
    doCreate();
  }
}

function ensureUI(name) {
  if (!botElements[name]) createBotUI(name);
}

// bot ui
function createBotUI(name) {
  if (botElements[name]) return;

  addTab(name);

  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  panel.id = `tab-${name}`;

  const head = document.createElement('img');
  head.className = 'bot-head';
  head.src = `https://mc-heads.net/avatar/${name}/32`;
  head.alt = name;

  const nameEl = document.createElement('span');
  nameEl.className = 'bot-name';
  nameEl.textContent = name;

  const disconnectBtn = document.createElement('button');
  disconnectBtn.className = 'disconnect-btn';
  disconnectBtn.title = 'Disconnect bot';
  disconnectBtn.textContent = 'Disconnect ' + name;
  disconnectBtn.onclick = () => disconnectBot(name);

  const header = document.createElement('div');
  header.className = 'bot-header';
  header.appendChild(head);
  header.appendChild(nameEl);
  header.appendChild(disconnectBtn);

  const cmdInput = document.createElement('input');
  cmdInput.className = 'cmd';
  cmdInput.placeholder = 'Chat to send for the ' + name + ' bot (include /s for commands)...';

  const sendBtn = document.createElement('button');
  sendBtn.className = 'send';
  sendBtn.textContent = 'Send';

  const cmdRow = document.createElement('div');
  cmdRow.className = 'cmd-row';
  cmdRow.appendChild(cmdInput);
  cmdRow.appendChild(sendBtn);

  const scoreboardEl = document.createElement('div');
  scoreboardEl.className = 'scoreboard';

  const logsEl = document.createElement('div');
  logsEl.className = 'logs';

  panel.appendChild(header);
  panel.appendChild(cmdRow);
  panel.appendChild(scoreboardEl);
  panel.appendChild(logsEl);

  sendBtn.onclick = () => {
    socket.emit("sendCommand", { botName: name, command: cmdInput.value });
  };

  document.querySelector('.main').appendChild(panel);

  botElements[name] = { panel, logsEl, scoreboardEl, sendBtn, cmdInput };
}

// disconnect event
function disconnectBot(name) {
  if (!confirm(`Disconnect ${name}?`)) return;

  socket.emit("disconnectBot", name);

  const entry = botElements[name];

  // rem all keys okey
  const allKeys = Object.keys(botElements).filter(k => botElements[k] === entry);
  for (const key of allKeys) {
    document.querySelector(`.tab[data-tab="${key}"]`)?.remove();
    activeBotNames.delete(key);
    if (window._statIntervals[key]) {
      clearInterval(window._statIntervals[key]);
      delete window._statIntervals[key];
    }
    delete botElements[key];
  }

  entry?.panel.remove();

  if (allKeys.includes(currentTab)) switchTab('master');
}

// stats for each bot
async function fetchStats(username, scoreboardEl) {
  try {
    const res = await fetch(`/api/stats/${username}`);
    if (!res.ok) return;
    const json = await res.json();
    const data = json?.result;
    if (!data || !scoreboardEl) return;

    scoreboardEl.replaceChildren(
      line(`💰 Money: ${fmt(data.money)}`),
      line(`💎 Shards: ${fmt(data.shards)}`),
      line(`⚔️ Kills: ${fmt(data.kills)}`),
      line(`💀 Deaths: ${fmt(data.deaths)}`),
      line(`⛏ Broken: ${fmtCommas(data.broken_blocks)}`),
      line(`🏗 Placed: ${fmtCommas(data.placed_blocks)}`),
      line(`🧟 Mobs: ${fmtCommas(data.mobs_killed)}`),
      line(`⏱ Playtime: ${fmtTime(data.playtime)}`),
      line(`🛒 Shop Spent: ${fmt(data.money_spent_on_shop)}`),
      line(`💸 Earned: ${fmt(data.money_made_from_sell)}`)
    );
  } catch (e) {
    console.error("Stats error:", e);
  }
}

//custom players search
async function searchPlayer() {
  const name = document.getElementById('search-username').value.trim();
  if (!name) return;

  const box = document.getElementById('search-result');
  box.style.display = 'block';
  box.replaceChildren(line('Loading...'));

  try {
    const res = await fetch(`/api/stats/${name}`);
    if (!res.ok) { box.replaceChildren(line('Player not found.')); return; }
    const json = await res.json();
    const data = json?.result;
    if (!data) { box.replaceChildren(line('No data.')); return; }

    box.replaceChildren(
      line(`💰 Money: ${fmt(data.money)}`),
      line(`💎 Shards: ${fmt(data.shards)}`),
      line(`⚔️ Kills: ${fmt(data.kills)}`),
      line(`💀 Deaths: ${fmt(data.deaths)}`),
      line(`⛏ Broken: ${fmtCommas(data.broken_blocks)}`),
      line(`🏗 Placed: ${fmtCommas(data.placed_blocks)}`),
      line(`🧟 Mobs: ${fmtCommas(data.mobs_killed)}`),
      line(`⏱ Playtime: ${fmtTime(data.playtime)}`),
      line(`🛒 Shop Spent: ${fmt(data.money_spent_on_shop)}`),
      line(`💸 Earned: ${fmt(data.money_made_from_sell)}`)
    );
  } catch (e) {
    box.replaceChildren(line('Error fetching stats.'));
  }
}

// broadcast for all accs
function broadcastCommand() {
  const cmd = document.getElementById('master-cmd').value.trim();
  if (!cmd) return;
  socket.emit("broadcastCommand", { command: cmd });
}

// LS
function saveBot(username, host) {
  const saved = getSaved();
  if (!saved.find(b => b.username === username)) {
    saved.push({ username, host });
    localStorage.setItem('donut_bots', JSON.stringify(saved));
  }
}

function getSaved() {
  try { return JSON.parse(localStorage.getItem('donut_bots')) || []; }
  catch { return []; }
}

//email to saved entry update saved
function updateSavedUsername(email, username) {
  if (email === username) return;
  const saved = getSaved();
  const entry = saved.find(b => b.username === email);
  if (!entry) return;
  entry.username = username;
  localStorage.setItem('donut_bots', JSON.stringify(saved));
  renderSavedBots();
}

function removeBot(username) {
  const saved = getSaved().filter(b => b.username !== username);
  localStorage.setItem('donut_bots', JSON.stringify(saved));
  renderSavedBots();
}

function renderSavedBots() {
  const container = document.getElementById('saved-bots');
  container.innerHTML = '';
  getSaved().forEach(({ username, host }) => {
    const btn = document.createElement('div');
    btn.className = 'saved-bot';
    btn.innerHTML = `
            <img src="https://mc-heads.net/avatar/${username}/24" alt="">
            <span>${username}</span>
            <button class="remove-btn" title="Remove">✕</button>
        `;
    btn.querySelector('img').onclick = () => {
      document.getElementById('username').value = username;
      document.getElementById('host').value = host;
      createBot();
      btn.remove();
    };
    btn.querySelector('span').onclick = btn.querySelector('img').onclick;
    btn.querySelector('.remove-btn').onclick = (e) => {
      e.stopPropagation();
      removeBot(username);
    };
    container.appendChild(btn);
  });
}

// line helper
function line(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

// init
renderSavedBots();
