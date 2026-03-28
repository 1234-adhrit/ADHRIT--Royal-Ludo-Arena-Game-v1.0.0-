# Royal Ludo Arena

Realtime multiplayer Ludo web app where players can:

- create private servers
- join servers by code
- play `1v1`, `1v1v1`, or `1v1v1v1`
- let only the server creator start the match

## Tech Stack

- Node.js + Express
- Socket.IO for realtime multiplayer sync
- HTML/CSS/Vanilla JS frontend with canvas board rendering

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start in development mode:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

For production run:

```bash
npm start
```

## Game Flow

1. Player creates a server and selects the mode (`2`, `3`, or `4` players).
2. Server code is shared with friends.
3. Players join with name + room code.
4. Host starts once all slots are filled.
5. Turns, dice rolls, token movement, captures, and winner logic are synced server-side.

## Deploy Notes

- Deploy on a platform that supports persistent Node processes and WebSockets (for example Render, Railway, Fly.io, or a VPS).
- Pure static hosts (like basic GitHub Pages) will not work because the Socket.IO server must run continuously.
- Set `PORT` from environment (already supported by `server.js`).

## Quick Publish (Render)

1. Push this project to a GitHub repository.
2. Open Render and click **New +** -> **Blueprint**.
3. Connect your GitHub repo and select this project.
4. Render will detect [`render.yaml`](./render.yaml) and create the web service automatically.
5. Wait for deployment to finish, then open your Render URL.

The game and WebSockets will run on the same URL.

## Scripts

- `npm run dev` - run with nodemon
- `npm start` - start production server
- `npm run check` - syntax check server and client JS

## Play Online

- https://royal-ludo-arena.onrender.com
