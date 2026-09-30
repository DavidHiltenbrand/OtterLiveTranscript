/**
 * Otter conversation URLs look like https://otter.ai/u/<conversation id>.
 * A bare conversation id is accepted as well.
 */
export function parseConversationId(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) {
    return { id: null, error: 'Paste an Otter meeting URL.' }
  }

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /otter\.ai/i.test(trimmed)
  if (!looksLikeUrl) {
    if (/^[A-Za-z0-9_-]{4,128}$/.test(trimmed)) {
      return { id: trimmed, error: null }
    }
    return {
      id: null,
      error: 'Paste an Otter meeting URL, or the conversation id itself.',
    }
  }

  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`
  let url
  try {
    url = new URL(href)
  } catch {
    return { id: null, error: 'That meeting link is not a valid URL.' }
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host !== 'otter.ai' && !host.endsWith('.otter.ai')) {
    return {
      id: null,
      error: 'Use a link from otter.ai, like https://otter.ai/u/your-conversation-id.',
    }
  }

  let parts = []
  try {
    parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  } catch {
    return { id: null, error: 'That meeting link has a broken conversation id.' }
  }

  const marker = parts.findIndex((part) => part.toLowerCase() === 'u')
  if (marker >= 0 && parts[marker + 1]) {
    return { id: parts[marker + 1], error: null }
  }

  const conversations = parts.findIndex((part) => part.toLowerCase() === 'conversations')
  if (conversations >= 0 && parts[conversations + 1]) {
    return { id: parts[conversations + 1], error: null }
  }

  return {
    id: null,
    error: 'Could not find a conversation id. Otter links usually look like https://otter.ai/u/…',
  }
}
