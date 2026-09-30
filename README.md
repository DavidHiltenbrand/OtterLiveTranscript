# Otter Live Deltas

A simple web app for watching an [Otter](https://otter.ai) conversation live. Paste an API key and a meeting URL, and the page polls Otter every 15 seconds. Each response is cached. The next response is compared with that cache, and a card is added with only the new or corrected words.

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:41721](http://127.0.0.1:41721).

The dev server proxies `/otter-api` to `https://api.otter.ai` so the browser can call Otter without a CORS error. Use `npm run dev` for that proxy. `npm run preview` only serves the built page and will not forward API calls.

## Use it

1. In Otter, open **Integrations → Developer** and create an API key. Public API access is on Enterprise workspaces.
2. Copy the meeting link. It looks like `https://otter.ai/u/<conversation id>`. A bare conversation id works too.
3. Choose **Start polling**. The first poll caches the payload and shows the opening transcript. Every poll after that adds a card with the delta.
4. Choose **Stop polling** to leave the cards and the cached payload on the page.

**Preview a sample meeting** runs the same 15-second loop against a fictional transcript, with no API key and no call to Otter.

The API key is kept in this browser tab (`sessionStorage`) so a refresh does not wipe it. The transcript cache stays in memory and is dropped on refresh. The key is not written into the cached payload.

## What it calls

```http
GET /v1/conversations/{id}?include=transcript
Authorization: Bearer YOUR_API_KEY
```

The transcript is the plain-text field `data.relationships.transcript.content`. Turns look like this:

```text
Jane Doe  00:00
Thanks everyone for joining.

Alex Taylor  00:07
Right now we take notes manually.
```

The delta keeps new speaker turns, words appended to an in-progress turn, and words Otter corrected. A poll that matches the cache updates a single “no new words” card instead of repeating the transcript.

## Tests

```bash
npm test
```
