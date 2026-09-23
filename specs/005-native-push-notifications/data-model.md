# Data Model: Native-Looking PWA Push Notifications

## Existing Notification

Represents one in-app activity event for one authorized recipient and is reused as the stable identity for optional push delivery.

| Field | Type/shape | Rules |
|---|---|---|
| `id` | opaque identifier | Required; carried into push metadata as the event identity. |
| `userId` | user identifier | Required recipient; must remain within the existing family authorization boundary. |
| `actorId` | user identifier | Required actor for supported events; presentation falls back safely if actor details are unavailable. |
| `postId` | post identifier | Required for post, comment, and mention destinations in current coverage. |
| `commentId` | optional comment identifier | Used to distinguish multiple comment events on the same post. |
| `type` | existing event type | Drives title/body wording and presentation conventions. |
| `readAt` | nullable timestamp | Existing in-app read state; push interaction may acknowledge the event without bypassing authorization. |
| `createdAt` | timestamp | Source time for stable event ordering and duplicate reasoning. |
| `feedId` | feed identifier | Preserves family-feed context and private routing. |

## Device Subscription

Represents one browser/device endpoint authorized to receive push alerts for a user.

| Field | Type/shape | Rules |
|---|---|---|
| `id` | opaque identifier | Existing record identity. |
| `userId` | user identifier | Required owner; subscription operations require the current authenticated session. |
| `endpoint` | validated endpoint string | Required and globally unique; invalid or expired endpoints are removed through existing cleanup behavior. |
| `userAgent` | optional descriptive string | Diagnostic metadata only; never used as authorization. |
| `p256dh` / `auth` | validated subscription keys | Required for delivery; never exposed in notification content. |
| `expirationTime` | optional timestamp | Preserved from the browser subscription when available. |
| `createdAt` / `updatedAt` | timestamps | Used for lifecycle and diagnostics. |

## Push Notification Presentation

A derived, user-visible representation of an existing notification event.

| Field | Type/shape | Rules |
|---|---|---|
| `notificationId` | existing notification identifier | Required stable event identity for tag, click, and duplicate handling. |
| `title` | bounded plain text | Event-specific, branded, and free of raw technical fields. |
| `body` | bounded plain text | Includes actor/activity context; safely truncates optional content. |
| `url` | authenticated relative destination | Points to the related post or a safe fallback; never a public media URL. |
| `tag` | deterministic event tag | Includes the notification identity so unrelated events are not collapsed. |
| `icon` / `badge` | approved app assets | Uses existing Famstagram PWA branding assets. |
| `data` | structured metadata | Includes notification ID and destination context needed by the worker. |

## State Transitions

1. An existing notification is created for an authorized recipient.
2. If the recipient has an enabled valid device subscription, the event is transformed into a bounded push presentation and sent.
3. The service worker receives the event, suppresses an already-handled duplicate when possible, and displays it unless foreground handling makes a redundant alert undesirable.
4. The recipient taps the alert; the worker routes an existing client or opens the PWA to the target.
5. The app validates the session and authorization, then displays the related post or a safe unavailable fallback and may mark the in-app notification read through the existing action.
6. Permission denial, unsupported capability, invalid subscription, or transient push failure leaves the in-app notification available and exposes recovery through settings.

No new persistent entity or database relation is required by the design unless implementation proves that durable delivery/handled state cannot be represented by the existing notification ID and subscription lifecycle.
