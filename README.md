# DrFlayer

A Donut SMP Mineflayer bot for AFKing shards and making money.

Features:

* Clean GUI
* Microsoft login support
* Auto reconnecting
* Live chat + stats
* Auto joins AFK room 10
* Minecraft 1.21.4 support

---

## Installation

### 1. Download

Download the ZIP or clone with Git.

### 2. Open the folder

Open the project folder in terminal/cmd.

### 3. Install dependencies

```bash
npm install
```

### 4. Start the panel

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

---

## Adding a Bot

<img width="861" height="350" alt="image" src="https://github.com/user-attachments/assets/6dfb7285-70a5-4e0f-86a3-b7f26e0eaba7" />

Enter your Minecraft Microsoft email and leave the server as default (`play.donutsmp.net`).

The server box is disabled because this is mainly built for Donut SMP.

---

## Microsoft Login

<img width="338" height="281" alt="image" src="https://github.com/user-attachments/assets/768e881a-4a35-4eb7-a645-c637a9d9c204" />

When prompted, open the Microsoft link and enter the code.

Authentication gets saved in the `auth/` folder so you usually won't need to log in again for 30-60 days.

---

## Bot Panel

<img width="1717" height="394" alt="image" src="https://github.com/user-attachments/assets/ad375712-77bc-4ebd-9d32-03bd40401302" />

Each connected bot gets its own tab with live chat, logs, stats, and reconnect handling.

---

## Notes

* Donut SMP allows around 5 bots per IP
* DrFlayer warns you before hitting the limit
* Auth files are stored locally in `auth/`
