# Research: Native-Looking PWA Push Notifications

## Decision: Extend the existing push payload and service-worker boundary

**Rationale**: Famstagram already sends push alerts through `lib/push.ts` and displays them in `public/sw.js`. Improving the payload and worker together preserves the existing delivery channel while enabling consistent branding, stable event identity, destination routing, foreground handling, and duplicate suppression.

**Alternatives considered**:
- Replace the push provider: rejected because it adds operational complexity without improving the user-facing requirement.
- Render all notification UI inside the web app only: rejected because it would not improve alerts received while the PWA is backgrounded or closed.

## Decision: Use existing notification record identity as the event identity

**Rationale**: `Notification` records already represent the recipient, actor, event type, related post/comment, read state, and creation time. Carrying the record ID into the push payload gives the service worker and click path a stable identity without introducing a second event table.

**Alternatives considered**:
- Add a separate push-delivery table: rejected for this increment because it duplicates notification identity and would require new lifecycle and cleanup rules.
- Use only the post ID as the deduplication key: rejected because several events can target the same post.

## Decision: Keep device subscriptions independent while preserving current account semantics

**Rationale**: The existing schema supports multiple endpoints per user and the subscription endpoint is globally unique. The feature should improve truthful state and recovery in the existing settings flow without silently changing whether settings are account-wide or device-specific.

**Alternatives considered**:
- Add per-device preference records: deferred until product requirements define account-versus-device preference semantics.
- Treat any stored endpoint as proof that the current browser is enabled: rejected because it produces misleading settings state.

## Decision: Navigate existing clients to the target before opening a new window

**Rationale**: A notification click should feel like a native deep link. The current worker only focuses a client whose pathname already matches, which can leave a different open Famstagram page unchanged. The worker should prefer an existing app client, post a navigation message or navigate it to the authorized target, and only open a new window when no suitable client exists.

**Alternatives considered**:
- Always open a new window: rejected because it creates duplicate tabs and loses the current session context.
- Depend on notification-center links only: rejected because the primary action should land on the related content directly.

## Decision: Preserve in-app notifications as the source of truth on push failure

**Rationale**: Existing notification creation occurs before push delivery and invalid subscriptions are cleaned up after failed delivery. The native presentation work must keep that ordering and make permission, unsupported-browser, and delivery failures visible without removing the in-app event.

**Alternatives considered**:
- Roll back in-app notification creation when push fails: rejected because push is an optional channel and transient failures should not lose activity.

## Decision: Validate behavior with focused runtime tests plus browser/PWA checks

**Rationale**: Existing tests cover comment recipients and push content, but not service-worker parsing, click routing, subscription state, or duplicate handling. The implementation needs narrow tests for deterministic content/payload behavior and a quickstart matrix for foreground, background, closed-PWA, denied-permission, and stale-destination cases.

**Alternatives considered**:
- Rely only on manual browser checks: rejected because payload and authorization regressions can silently recur.
- Add a full browser automation framework: deferred; the existing test/build setup can cover pure logic while the quickstart captures device behavior.

## Decision: Normalize notification text and keep the encrypted payload compact

**Rationale**: Notification titles and bodies are rendered as plain text, but uncontrolled whitespace and long captions can still cause poor wrapping across operating systems. Normalize line breaks/control whitespace, bound optional context, and keep the serialized payload comfortably below common push-service limits so encryption and bridge overhead do not cause delivery rejection.

**Alternatives considered**:
- Trust browser/OS truncation: rejected because rendering differs by platform and can hide the actor or activity.
- Send full captions or post content: rejected because it increases payload size and risks exposing more private content than the alert requires.

## Decision: Use both event-specific client tags and a delivery topic

**Rationale**: A service-worker `tag` prevents already-displayed notifications from colliding, while the Web Push `Topic` option lets the push service replace an undelivered retry for the same notification event. Both identifiers should derive from the existing notification ID, be bounded to provider limits, and remain distinct for unrelated events.

**Alternatives considered**:
- Use only a client-side tag: rejected because it cannot coalesce messages still queued at the push service.
- Use the post ID for both identifiers: rejected because multiple comments, mentions, or other events can target one post.

## Decision: Reuse same-origin clients for notification clicks

**Rationale**: On click, the worker should prefer an exact matching Famstagram window, then navigate and focus another same-origin app window, and open a new window only when no suitable client exists. This preserves session context and prevents duplicate tabs while leaving authorization and unavailable-content handling to the app.

**Alternatives considered**:
- Always open a new window: rejected because it creates duplicate tabs.
- Navigate arbitrary cross-origin clients: rejected because notification destinations must remain authenticated, relative, and same-origin.

## Decision: Gate permission and subscription creation behind one explicit action

**Rationale**: Modern browsers increasingly require a user gesture for both notification permission and `PushManager.subscribe()`. Settings must feature-detect Notification, Service Worker, and PushManager support, treat `default` permission as not enabled, and distinguish browser/device limitations from denied permission so the next action is truthful.

**Alternatives considered**:
- Prompt on page load: rejected because it is intrusive and blocked by browser policy.
- Detect browsers with user-agent strings: rejected because feature detection is more reliable across installed-PWA and Safari variants.
