# Discord CTF Challenge Bot

A production-ready Discord bot for running timed CTF challenges in a private
channel: a Host creates a challenge, members join, the Host starts it, a
server-side timer tracks progress, participants submit a flag to record
their finish, and the bot automatically ranks players and announces winners.

Built with **Node.js + TypeScript + discord.js + PostgreSQL + Prisma**.

---

## Features

- Button/modal-driven UX — no manual commands needed for the core flow
- Host creates a challenge via a modal (name, URL, time limit, prize, flag, description)
- Join / Leave before start, with duplicate-join protection
- Start requires host confirmation and at least 2 players
- Server-side timer (not just a Discord message countdown) — deadlines are
  read from the database, so timing survives a bot restart
- Flag verification via a modal; flags are hashed (scrypt + per-flag salt)
  and never stored or logged in plain text
- Automatic ranking by fastest completion time, tie-broken by server
  finish timestamp (millisecond precision)
- Automatic expiry when the timer runs out, with results announced automatically
- Player statistics (wins, podiums, points, best time) and a server leaderboard
- Multiple challenges over time, each with a unique code (`CTF-001`, `CTF-002`, ...)
- Host/admin-only management actions, enforced server-side on every interaction
- Slash commands: `/ctf create`, `/ctf leaderboard`, `/ctf stats`, `/ctf history`, `/ctf active`, `/ctf cancel`

---

## Project Structure

```text
src/
├── commands/         # slash commands (/ctf ...)
├── buttons/           # button interaction handlers
├── modals/             # modal builders + submit handlers
├── events/             # ready, interactionCreate
├── services/           # challengeService, embeds, timerService (core logic)
├── database/           # Prisma client singleton
├── utils/              # crypto, time formatting, permissions, sanitize
├── config/             # env loading, scoring config
└── index.ts            # entry point
prisma/schema.prisma     # database schema
```

---

## 1. Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, create a bot user and copy the **token** — this is `DISCORD_TOKEN`.
3. Under **General Information**, copy the **Application ID** — this is `CLIENT_ID`.
4. Under **Bot**, enable no privileged intents are required for this bot (it only uses Guilds + Guild Messages).
5. Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`,
   and permissions: `Send Messages`, `Embed Links`, `Read Message History`,
   `Use Application Commands`, `Manage Messages` (for editing the challenge embed).
6. Use the generated URL to invite the bot to your server.
7. Copy your server (guild) ID — this is `GUILD_ID`.
8. Restrict the bot's channel permissions in Discord so it (and the CTF flow)
   is only usable inside your private `#اختيار-التحدي-والمشاركين` channel.

---

## 2. Database Setup

You need a PostgreSQL database. The easiest path is Docker Compose (see below),
or point `DATABASE_URL` at any existing Postgres instance:

```text
postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public
```

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
DATABASE_URL=
ADMIN_ROLE_IDS=
CTF_CHANNEL_NAME=اختيار-التحدي-والمشاركين
```

Never commit `.env` or hardcode these values in source — the app will
refuse to start if any required variable is missing.

---

## 4. Local Installation

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init   # creates tables in your local DB
npm run deploy-commands               # registers /ctf slash commands
npm run dev                           # starts the bot with hot reload
```

For production:

```bash
npm run build
npx prisma migrate deploy
npm start
```

---

## 5. Docker Deployment

```bash
cp .env.example .env   # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
docker compose up -d --build
```

`docker-compose.yml` runs Postgres and the bot together; the bot container
runs `prisma migrate deploy` automatically on startup before launching.

After the containers are up, register slash commands once:

```bash
docker compose exec bot npm run deploy-commands
```

---

## 6. Commands

| Command | Description |
|---|---|
| `/ctf create` | Posts a button to open the "Create CTF Challenge" panel |
| `/ctf leaderboard` | Shows the top 10 players by points |
| `/ctf stats [user]` | Shows a player's stats (defaults to yourself) |
| `/ctf history` | Shows recent completed/expired challenges |
| `/ctf active` | Lists challenges currently waiting or in progress |
| `/ctf cancel <challenge_code>` | Cancels a waiting challenge you host (or any, if admin) |

The primary flow (create → join → start → finish → results) is entirely
button/modal driven and does not require typing commands.

---

## 7. Permissions Model

- Only the **Host** who created a challenge (or a member with the
  `Administrator` permission, or a role listed in `ADMIN_ROLE_IDS`) can
  start, cancel, or end that challenge.
- Every button interaction is re-validated **server-side** against the
  database on each click — the button itself grants no authority.
- The correct flag is stored as a salted hash (`scrypt`) and is never
  echoed back in any message, log, or embed.

---

## 8. Reliability

- All state (challenge status, start time, deadline, participants, finish
  times) lives in Postgres, not in memory.
- On boot, the bot re-attaches its in-memory timer loop to every challenge
  still `IN_PROGRESS`, reading the real deadline from the database — a
  restart never resets the clock or loses recorded finishes.
- Ties are broken using millisecond-precision server timestamps recorded at
  the moment each flag submission is verified.

---

## 9. Database Migrations

```bash
npx prisma migrate dev --name <description>   # create a new migration (dev)
npx prisma migrate deploy                       # apply migrations (prod)
npx prisma studio                                # inspect data visually
```

---

## 10. Notes on Verification

Version 1 verification is flag-based: participants press **FINISH**, submit
the flag in a modal, and the bot checks it against the stored hash. Incorrect
submissions are rejected but participants may retry. This is designed to be
swapped out later for other verification strategies (e.g. host manual
approval) without changing the ranking/timer logic.
