# SancharTag Server

API backend for SancharTag — a privacy-first vehicle QR contact platform. Owners tag their vehicles with QR stickers; anyone who scans one can chat or voice-call the owner **without ever seeing the owner's phone number**.

Node 20+ · Express 5 · MongoDB (Mongoose 9) · Socket.IO 4

## Setup

```bash
cp .env.example .env    # fill MONGODB_URI and JWT_SECRET
npm install
npm run dev             # nodemon
npm start               # production
npm test                # jest (in-memory Mongo, no env needed)
```

With `SMS_ENABLED=false` (default) the OTP is returned by `POST /auth/send-otp` — development only; that path is hard-disabled in production. Wire a real SMS provider in `services/smsService.js`.

## Architecture

```
routes → middlewares (validate → rate-limit → authenticate → authorize) → controllers → services / dbServices → models
```

| Layer | Rule |
|---|---|
| `routes/` | URL + middleware chain only, no logic |
| `controllers/` | destructure → delegate → `handleResponse`/`handleError`; never touch models |
| `services/` | business flows (messages, scans, SMS, push) |
| `dbServices/` | ALL Mongoose access; `.lean()` reads, allowlist-picked atomic writes |
| `models/` | schemas + indexes; secrets are `select: false` |
| `sockets/` | handshake-authenticated real-time (chat + WebRTC signaling) |

Uniform envelope: `{ success, message, data }` / errors add `code` (stable, SCREAMING_SNAKE from `config/errorCodes.js`).

## Auth model

- **Owners**: phone OTP → JWT session (HS512). Sliding refresh via the `x-refreshed-token` response header — idle life 30d, absolute cap 180d. Logout/password-events rotate the user's `jwtSalt`, killing every outstanding token.
- **Scanners**: `GET /scan/:tagId` issues a single-use, 15-min **scan token**; creating the interaction consumes it and returns a 24h **interaction token** scoped to that one interaction (REST + socket).
- **Sockets**: token in `socket.handshake.auth.token`; rooms are joined server-side; `senderRole` always derives from the authenticated identity.

## API surface (`/api/v1`)

```
GET   /health
POST  /auth/send-otp | /auth/verify-otp | /auth/logout
GET|PATCH|DELETE /users/me            DELETE cascades vehicles+interactions to archives
GET|POST /users/me/blocked            DELETE /users/me/blocked/:phoneNumber
GET|POST /vehicles                    PATCH|DELETE /vehicles/:vehicleId
GET   /scan/:tagId                    public, rate-limited, privacy-filtered
POST  /scan/:tagId/interactions       scan token required
GET   /interactions                   owner, paginated (?page&limit&status)
GET   /interactions/:id               owner or that interaction's scanner
POST  /interactions/:id/messages      single message path (same rules as socket)
PATCH /interactions/:id/status|resolve|read    DELETE /interactions/:id
POST  /reports                        owner or scanner; freezes a snapshot
GET   /reports                        owner's own
```

Socket events — in: `join_room`, `leave_room`, `send_message`, `end_session`, `callUser`, `answerCall`, `iceCandidate`, `endCall` · out: `receive_message`, `interaction_update`, `new_interaction`, `session_ended`, `callMade`, `callAccepted`, `callEnded`, `iceCandidate`, `app_error`.

## Migrating v1 data

`node scripts/migrate-restructure.js` — normalizes phones to E.164, dedupes users, backfills `jwtSalt`, strips legacy owner fields from vehicles, syncs indexes. Disposable dev data? Just drop the collections instead.

## Deliberately deferred

- SMS provider integration (`services/smsService.js` seam)
- Redis (socket.io adapter + `utils/pendingCallStore.js` are single-instance; interfaces are swap-ready)
- Admin/moderation surface for reports (the `status` workflow field already exists)
- TURN server for calls behind CGNAT
