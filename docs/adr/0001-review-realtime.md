# 0001. Realtime Product reviews over `ws`, single process

Status: accepted (2026-11-12)

## Context

The Product page must show new, edited, deleted and hidden Product reviews, and the new average Rating,
without a reload. Anyone may also leave a Guest comment (no account, no Rating). The app is one Node/Express
process today.

## Decision

- **Library: `ws`**, attached to the existing `http.Server` (`noServer` + `upgrade`), path `/ws/reviews?productId=`.
  We need one-way fan-out of small JSON events to browsers that support WebSocket natively. socket.io would add
  its own protocol (long-polling fallback, rooms, acks, a required client bundle), a second transport to secure
  and proxy, and ~10x the code surface, for features we do not use. `ws` is a thin, widely audited dependency and the
  browser needs no library.
- **One room per Product.** The hub (`src/realtime/review-hub.js`) keeps `productId -> Set<socket>` in memory.
  Services publish `{type, review, aggregate}` after the database write has returned (so after commit), only
  when somebody is watching that Product. The payload is the public list shape (`authorType`, display name,
  Rating, comment, dates) plus the aggregate; never an email or user id. Broadcast errors are logged and never fail
  the HTTP request.
- **Types:** `review.created`, `review.updated`, `review.deleted`, `review.hidden`. An admin un-hide is sent as
  `review.updated` (the client upserts). Changes to a review an admin has hidden are not broadcast.
- **Hardening:** the `Origin` header must be present and listed in `APP_ORIGIN` (the same list CSRF uses), otherwise
  403; `productId` must be a positive int32; client frames are capped at 256 bytes and a client that talks more than
  10 times is dropped (clients only listen); 20 connections per address (honours `TRUST_PROXY`) and 5000 in total;
  slow consumers (>1 MiB buffered) are terminated; 30 s ping/pong removes dead sockets.
  Guest comments are rate limited (`guestReview`: 5 per IP per 15 minutes), keep CSRF, accept only a cleaned
  Latin-script display name (2-60 chars, no staff/brand look-alikes) and a comment of at most 1000 characters.
- **Client fallback:** `public/js/review-live.js` reconnects with exponential backoff (1 s to 30 s, jittered) and
  polls the list every 30 s while the socket is down; it reloads once after every reconnect.

## Consequences

- **Single process only.** Rooms and the rate-limit buckets are process memory. With two or more app instances a
  comment posted on instance A is never pushed to watchers connected to instance B (they only catch up through the
  30 s poll or a reconnect). This is acceptable for one instance.
- **Next step for several instances (Wave 2):** publish the event to Redis pub/sub (one channel per Product or one
  shared channel); every instance subscribes and fans out to its own local rooms. Rate limits and the connection
  caps move to Redis at the same time. The hub's `publish(productId, event)` is the single seam to change.
- Graceful shutdown must close sockets first (`server-lifecycle.js` does), otherwise `server.close()` waits forever.
- A reverse proxy must forward `Upgrade`/`Connection` headers and keep idle connections open longer than 30 s.
