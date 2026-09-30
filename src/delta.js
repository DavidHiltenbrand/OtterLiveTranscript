/**
 * Parse Otter transcript text and return only what changed.
 *
 * GET /v1/conversations/{id}?include=transcript yields plain text:
 *
 *   Jane Doe  00:00
 *   Thanks everyone for joining.
 *
 *   Alex Taylor  00:07
 *   Right now we take notes manually.
 */

const HEADER_RE = /^(.{1,80}?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/

export function normalizeTranscript(content) {
  return String(content ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseTranscript(content) {
  const normalized = normalizeTranscript(content)
  if (!normalized) return []

  const segments = []
  let current = null

  const finish = () => {
    if (!current) return
    const text = current.lines.join(' ').replace(/[ \t]{2,}/g, ' ').trim()
    segments.push({ speaker: current.speaker, time: current.time, text })
    current = null
  }

  for (const raw of normalized.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const header = line.match(HEADER_RE)
    if (header) {
      const speaker = header[1].trim()
      if (speaker && speaker.length <= 60 && !/[.!?]$/.test(speaker)) {
        finish()
        current = { speaker, time: header[2], lines: [] }
        continue
      }
    }
    if (!current) current = { speaker: '', time: '', lines: [] }
    current.lines.push(line)
  }

  finish()
  return segments.filter((segment) => segment.speaker || segment.text)
}

export function countWords(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Difference between two utterance strings.
 * append  — the new text continues the old text
 * rewrite — Otter corrected words already cached
 */
export function diffText(before, after) {
  const a = before ?? ''
  const b = after ?? ''
  if (a === b) return null
  if (!a.trim()) {
    const text = b.trim()
    return text ? { type: 'append', text, partial: false } : null
  }
  if (!b.trim()) return null
  if (a.trim() === b.trim()) return null

  if (b.startsWith(a)) {
    const text = b.slice(a.length).trim()
    return text ? { type: 'append', text, partial: true } : null
  }

  let prefix = 0
  const max = Math.min(a.length, b.length)
  while (prefix < max && a[prefix] === b[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }

  let start = prefix
  let end = b.length - suffix
  const isWordChar = (char) => Boolean(char) && !/[\s.,!?;:'"()[\]]/.test(char)
  while (start > 0 && isWordChar(b[start - 1])) start -= 1
  while (end < b.length && isWordChar(b[end])) end += 1

  const text = b.slice(start, end).replace(/\s+/g, ' ').trim()
  if (!text) return { type: 'rewrite', text: b.trim(), partial: false }
  return {
    type: 'rewrite',
    text,
    partial: text !== b.trim(),
  }
}

function textsOverlap(prev, next) {
  if (!prev.text || !next.text) return false
  return (
    prev.text === next.text ||
    next.text.startsWith(prev.text) ||
    prev.text.startsWith(next.text)
  )
}

function turnsAlign(prev, next) {
  if (prev.speaker && next.speaker && prev.speaker !== next.speaker) {
    return prev.text.length > 12 && textsOverlap(prev, next)
  }
  if (prev.time && next.time && prev.time === next.time) return true
  return textsOverlap(prev, next)
}

function alignTurns(previous, next) {
  const pairs = []
  let cursor = 0

  for (const segment of next) {
    let found = -1
    const windowEnd = Math.min(previous.length, cursor + 4)
    for (let index = cursor; index < windowEnd; index += 1) {
      if (turnsAlign(previous[index], segment)) {
        found = index
        break
      }
    }
    if (found >= 0) {
      pairs.push({ previous: previous[found], next: segment })
      cursor = found + 1
    } else {
      pairs.push({ previous: null, next: segment })
    }
  }

  return pairs
}

function hasSpeakers(segments) {
  return segments.length > 0 && segments.every((segment) => segment.speaker)
}

/**
 * Compare a cached transcript with the next poll.
 * kind: 'initial' | 'delta' | 'unchanged'
 */
export function diffTranscript(previous, next) {
  const prevNorm = normalizeTranscript(previous)
  const nextNorm = normalizeTranscript(next)

  if (!nextNorm) {
    return { kind: 'unchanged', segments: [], wordCount: 0 }
  }

  if (!prevNorm) {
    const segments = parseTranscript(nextNorm).map((segment) => ({
      ...segment,
      change: 'new',
      partial: false,
    }))
    const source = segments.length
      ? segments.map((segment) => segment.text).join(' ')
      : nextNorm
    return { kind: 'initial', segments, wordCount: countWords(source) }
  }

  if (prevNorm === nextNorm) {
    return { kind: 'unchanged', segments: [], wordCount: 0 }
  }

  const prevSegs = parseTranscript(prevNorm)
  const nextSegs = parseTranscript(nextNorm)

  if (!hasSpeakers(prevSegs) || !hasSpeakers(nextSegs)) {
    const change = diffText(prevNorm, nextNorm)
    if (!change) return { kind: 'unchanged', segments: [], wordCount: 0 }
    return {
      kind: 'delta',
      segments: [
        {
          speaker: '',
          time: '',
          text: change.text,
          change: change.type === 'append' ? 'continued' : 'revised',
          partial: change.partial,
        },
      ],
      wordCount: countWords(change.text),
    }
  }

  const segments = []
  for (const pair of alignTurns(prevSegs, nextSegs)) {
    if (!pair.previous) {
      segments.push({ ...pair.next, change: 'new', partial: false })
      continue
    }
    if (pair.previous.text === pair.next.text) continue
    const change = diffText(pair.previous.text, pair.next.text)
    if (!change) continue
    segments.push({
      speaker: pair.next.speaker,
      time: pair.next.time,
      text: change.text,
      change: change.type === 'append' ? 'continued' : 'revised',
      partial: change.partial,
    })
  }

  if (!segments.length) {
    return { kind: 'unchanged', segments: [], wordCount: 0 }
  }

  return {
    kind: 'delta',
    segments,
    wordCount: countWords(segments.map((segment) => segment.text).join(' ')),
  }
}

export function extractTranscript(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
  const relationships =
    (data.relationships && typeof data.relationships === 'object' && data.relationships) ||
    (payload.relationships && typeof payload.relationships === 'object' && payload.relationships) ||
    {}
  const transcript = relationships.transcript ?? data.transcript ?? null
  if (!transcript) return ''
  if (typeof transcript === 'string') return transcript
  if (typeof transcript.content === 'string') return transcript.content
  return ''
}
