# Push Event Contract

## Purpose

Define the payload boundary between Famstagram push delivery and the PWA service worker. The payload represents an existing authorized in-app notification; it does not grant access to the destination.

## Payload

```json
{
  "notificationId": "string",
  "title": "string",
  "body": "string",
  "url": "/post/<id> or /notifications",
  "tag": "string",
  "icon": "/icons/icon-192.png",
  "badge": "/icons/icon-192.png",
  "data": {
    "notificationId": "string",
    "url": "string",
    "feedId": "string"
  }
}
```

## Invariants

- `notificationId` is stable for the event and recipient and is present both at the top level and in `data` when the worker needs it.
- `title` and `body` are bounded plain text and contain no subscription keys, private media URLs, or raw implementation fields.
- `url` is an authenticated relative application path; the service worker never constructs a public media URL from payload content.
- `tag` distinguishes unrelated events and is deterministic for duplicate suppression.
- Missing optional fields must use safe defaults rather than causing worker parsing failures.
- Click handling must re-enter normal session and family authorization checks.

## Compatibility

The worker should continue to tolerate legacy payloads that only contain `title`, `body`, `url`, `tag`, and `data.url` while the server and worker are rolled forward together.
