import { countWords, diffTranscript, extractTranscript, normalizeTranscript, parseTranscript } from './delta.js'
import { parseConversationId } from './meeting.js'
import { samplePayload } from './sample.js'

const POLL_MS = 15000
const SESSION_KEY = 'otter-live-deltas'
const SPEAKER_COLORS = ['#144fff', '#8a78f0', '#419220', '#0e7c86', '#c45c26', '#6b4c9a', '#fe565b']

const form = document.querySelector('#connect-form')
const apiKeyInput = document.querySelector('#api-key')
const meetingInput = document.querySelector('#meeting-url')
const idHint = document.querySelector('#id-hint')
const formError = document.querySelector('#form-error')
const startBtn = document.querySelector('#start-btn')
const stopBtn = document.querySelector('#stop-btn')
const sampleBtn = document.querySelector('#sample-btn')
const forgetBtn = document.querySelector('#forget-btn')
const clearBtn = document.querySelector('#clear-btn')
const toggleKeyBtn = document.querySelector('#toggle-key')
const cacheBody = document.querySelector('#cache-body')
const titleEl = document.querySelector('#meeting-title')
const summaryEl = document.querySelector('#meeting-summary')
const metaEl = document.querySelector('#meeting-meta')
const eyebrowEl = document.querySelector('#eyebrow')
const statusPill = document.querySelector('#status-pill')
const statusLabel = document.querySelector('#status-label')
const countdownEl = document.querySelector('#countdown')
const feed = document.querySelector('#feed')

let mode = 'idle'
let timer = null
let tickTimer = null
let nextAt = 0
let inFlight = false
let pollIndex = 0
let sampleFrame = 0
let quietCard = null
let cache = null
let conversationId = null
let lastNote = ''
let generation = 0

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') {
      for (const [name, dataValue] of Object.entries(value)) node.dataset[name] = String(dataValue)
    } else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '•'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function colorFor(name) {
  let hash = 0
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length]
}

function speechWordCount(transcript) {
  const segments = parseTranscript(transcript)
  if (!segments.length) return countWords(transcript)
  return countWords(segments.map((segment) => segment.text).join(' '))
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function shortWhen(iso) {
  if (!iso) return 'just now'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return clock(date)
}

function setFormError(message) {
  if (!message) {
    formError.hidden = true
    formError.textContent = ''
    return
  }
  formError.hidden = false
  formError.textContent = message
}

function setBusy(isBusy) {
  apiKeyInput.disabled = isBusy
  meetingInput.disabled = isBusy
  startBtn.disabled = isBusy
  sampleBtn.disabled = isBusy
  forgetBtn.disabled = isBusy
  clearBtn.disabled = isBusy
  stopBtn.disabled = !isBusy
}

function setStatus(state, label) {
  statusPill.dataset.state = state
  statusLabel.textContent = label
}

function remember() {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        apiKey: apiKeyInput.value,
        meetingUrl: meetingInput.value,
      }),
    )
  } catch {
    // Session storage can be blocked. The fields still work for this page view.
  }
}

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}')
    if (typeof saved.apiKey === 'string') apiKeyInput.value = saved.apiKey
    if (typeof saved.meetingUrl === 'string') meetingInput.value = saved.meetingUrl
  } catch {
    // Ignore unreadable session data.
  }
}

function updateIdHint() {
  const parsed = parseConversationId(meetingInput.value)
  if (!meetingInput.value.trim()) {
    idHint.textContent = ''
    return
  }
  if (!parsed.id) {
    idHint.textContent = ''
    return
  }
  idHint.replaceChildren('Conversation id ', h('code', { text: parsed.id }))
}

const EMPTY_MARK = `<svg viewBox="0 0 32 32" aria-hidden="true" width="72" height="72">
  <rect width="32" height="32" rx="10" fill="#144fff"/>
  <circle cx="11" cy="12" r="2.3" fill="#ffffff"/>
  <circle cx="21" cy="12" r="2.3" fill="#ffffff"/>
  <ellipse cx="16" cy="18.5" rx="8.2" ry="7.2" fill="#ffffff"/>
  <circle cx="13.1" cy="17.6" r="1.15" fill="#041d34"/>
  <circle cx="18.9" cy="17.6" r="1.15" fill="#041d34"/>
  <ellipse cx="16" cy="20.4" rx="1.45" ry="1.05" fill="#8a78f0"/>
</svg>`

function showEmpty() {
  const wrap = h('div', { class: 'empty', id: 'empty-state' })
  wrap.insertAdjacentHTML('beforeend', EMPTY_MARK)
  wrap.append(
    h('h2', { text: 'Nothing captured yet' }),
    h('p', {
      text: 'Paste a meeting link and your Otter API key, then start polling. Every 15 seconds the conversation is fetched, cached, and compared. Each card after the baseline is only the new or corrected words.',
    }),
  )
  feed.replaceChildren(wrap)
  clearBtn.hidden = true
}

function resetSessionView() {
  if (timer) clearTimeout(timer)
  if (tickTimer) clearInterval(tickTimer)
  timer = null
  tickTimer = null
  inFlight = false
  pollIndex = 0
  sampleFrame = 0
  quietCard = null
  cache = null
  conversationId = null
  countdownEl.textContent = ''
  titleEl.textContent = 'Only the new words'
  summaryEl.textContent =
    'Poll a conversation every 15 seconds. Each response is cached, and the next card shows just the delta.'
  eyebrowEl.textContent = 'Live transcript'
  metaEl.hidden = true
  metaEl.replaceChildren()
  document.title = 'Otter Live Deltas'
  renderCache()
  showEmpty()
}

function paintCountdown() {
  if (mode === 'idle') return
  if (inFlight) {
    countdownEl.textContent = mode === 'sample' ? 'Playing the next sample slice…' : 'Checking Otter…'
    return
  }
  const seconds = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000))
  const prefix = lastNote ? `${lastNote} ` : ''
  countdownEl.textContent = `${prefix}Next check in ${seconds}s.`
}

function startCountdown() {
  nextAt = Date.now() + POLL_MS
  if (tickTimer) clearInterval(tickTimer)
  paintCountdown()
  tickTimer = setInterval(paintCountdown, 250)
}

function scheduleNext(gen) {
  if (timer) clearTimeout(timer)
  startCountdown()
  timer = setTimeout(() => {
    void runPoll(gen)
  }, POLL_MS)
}

function begin(nextMode) {
  const id = conversationId
  generation += 1
  const gen = generation
  resetSessionView()
  conversationId = id
  mode = nextMode
  lastNote = ''
  setBusy(true)
  setFormError('')
  setStatus(nextMode === 'sample' ? 'sample' : 'checking', nextMode === 'sample' ? 'Sample' : 'Checking')
  if (nextMode === 'sample') {
    eyebrowEl.textContent = 'Sample meeting'
    summaryEl.textContent = 'This preview never calls Otter. A fictional transcript grows every 15 seconds.'
  }
  void runPoll(gen)
}

async function runPoll(gen) {
  if (mode === 'idle' || gen !== generation) return
  if (inFlight) {
    scheduleNext(gen)
    return
  }
  inFlight = true
  if (pollIndex === 0) showPending()
  else setStatus(mode === 'sample' ? 'sample' : 'checking', mode === 'sample' ? 'Sample' : 'Checking')

  try {
    const payload = mode === 'sample' ? samplePayload(sampleFrame++) : await fetchConversation()
    if (mode === 'idle' || gen !== generation) return
    publishPayload(payload)
    setStatus(mode === 'sample' ? 'sample' : 'live', mode === 'sample' ? 'Sample' : 'Listening')
  } catch (error) {
    if (mode === 'idle' || gen !== generation) return
    publishError(error)
    setStatus('error', 'Retrying')
  } finally {
    if (gen !== generation) return
    inFlight = false
    document.getElementById('checking-card')?.remove()
    if (mode !== 'idle') scheduleNext(gen)
  }
}

async function fetchConversation() {
  const endpoint = `/otter-api/v1/conversations/${encodeURIComponent(conversationId)}?include=transcript`
  let response
  try {
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKeyInput.value.trim()}`,
        Accept: 'application/json',
      },
    })
  } catch {
    const error = new Error('Could not reach Otter through the local proxy. Keep this page on the dev server.')
    error.status = 0
    throw error
  }

  const raw = await response.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = { message: raw.slice(0, 280) }
  }

  if (!response.ok) {
    const error = new Error(messageForStatus(response.status, payload))
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

function messageForStatus(status, payload) {
  const detail = firstMessage(payload)
  const vague = !detail || /^(unauthorized|forbidden|not found|error|bad request)$/i.test(detail)
  if (status === 401 || status === 403) {
    return vague
      ? 'Otter rejected this API key. Create one under Integrations → Developer.'
      : detail
  }
  if (status === 404) {
    return vague ? 'Otter could not find that conversation. Check the meeting URL.' : detail
  }
  if (status === 429) return 'Otter rate-limited this request. Polling will try again in 15 seconds.'
  if (status >= 500) {
    return vague ? 'Otter had trouble returning this conversation. The next poll will retry.' : detail
  }
  return vague ? `Otter returned status ${status}.` : detail
}

function firstMessage(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const candidates = [payload.message, payload.detail, payload.error_description, payload.error]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === 'object' && typeof candidate.message === 'string') {
      return candidate.message.trim()
    }
  }
  return ''
}

function publishPayload(payload) {
  const transcript = normalizeTranscript(extractTranscript(payload))
  const previous = cache?.transcript ?? ''
  const hadTranscript = Boolean(previous)

  if (!transcript && hadTranscript) {
    pollIndex += 1
    lastNote = `Poll ${pollIndex} returned an empty transcript.`
    pushCard(waitingCard(pollIndex, 'This poll came back without transcript text. The previous transcript is still cached.'))
    renderCache()
    return
  }

  const delta = diffTranscript(previous, transcript)
  cache = {
    payload,
    transcript,
    cachedAt: new Date().toISOString(),
    retrievedAt: payload?.meta?.retrieved_at || null,
  }
  pollIndex += 1
  renderCache()
  renderMeeting(payload)

  if (!transcript) {
    lastNote = `Poll ${pollIndex} cached an empty transcript.`
    noteWaiting(pollIndex)
    return
  }

  if (delta.kind === 'unchanged') {
    lastNote = `Poll ${pollIndex} matched the cached transcript.`
    noteQuiet(pollIndex)
    return
  }

  quietCard = null
  pushCard(deltaCard(delta, pollIndex))
  lastNote =
    delta.kind === 'initial'
      ? `Poll ${pollIndex} cached the opening transcript.`
      : `Poll ${pollIndex} added ${delta.wordCount} new words.`
}

function publishError(error) {
  pollIndex += 1
  const message = error?.message || 'Something went wrong while polling Otter.'
  const latest = feed.firstElementChild
  if (latest?.dataset.kind === 'error' && latest.dataset.message === message) {
    const count = Number(latest.dataset.count || '1') + 1
    latest.dataset.count = String(count)
    latest.querySelector('[data-role="error-meta"]').textContent =
      `Poll ${pollIndex} · ${clock(new Date())} · seen ${count} times`
    lastNote = message
    return
  }
  const card = h(
    'article',
    { class: 'delta-card delta-card--error', dataset: { kind: 'error', message, count: '1' } },
    [
      h('div', { class: 'delta-card__meta' }, [
        h('span', { class: 'pill pill--red', text: 'Poll failed' }),
        h('span', { 'data-role': 'error-meta', text: `Poll ${pollIndex} · ${clock(new Date())}` }),
      ]),
      h('p', { class: 'delta-card__message', text: message }),
    ],
  )
  pushCard(card)
  lastNote = message
}

function noteQuiet(index) {
  const now = clock(new Date())
  if (quietCard?.dataset.latest === 'true') {
    const count = Number(quietCard.dataset.count || '1') + 1
    quietCard.dataset.count = String(count)
    quietCard.querySelector('[data-role="quiet-copy"]').textContent =
      `No new words · checked ${count} times · last ${now}`
    return
  }
  quietCard = h(
    'article',
    { class: 'delta-card delta-card--quiet', dataset: { kind: 'quiet', latest: 'true', count: '1' } },
    [
      h('div', { class: 'delta-card__meta' }, [
        h('span', { class: 'pill', text: `Poll ${index}` }),
        h('span', { 'data-role': 'quiet-copy', text: `No new words · checked 1 time · last ${now}` }),
      ]),
    ],
  )
  pushCard(quietCard)
}

function waitingCard(index, message) {
  return h('article', { class: 'delta-card delta-card--waiting', dataset: { kind: 'waiting' } }, [
    h('div', { class: 'delta-card__meta' }, [
      h('span', { class: 'pill', text: `Poll ${index}` }),
      h('span', { text: message }),
    ]),
  ])
}

function noteWaiting(index) {
  const message = 'Conversation cached. Otter has not included transcript text yet.'
  if (quietCard?.dataset.kind === 'waiting' && quietCard.dataset.latest === 'true') {
    const count = Number(quietCard.dataset.count || '1') + 1
    quietCard.dataset.count = String(count)
    quietCard.querySelector('[data-role="wait-copy"]').textContent = `${message} Checked ${count} times.`
    return
  }
  quietCard = h(
    'article',
    { class: 'delta-card delta-card--waiting', dataset: { kind: 'waiting', latest: 'true', count: '1' } },
    [
      h('div', { class: 'delta-card__meta' }, [
        h('span', { class: 'pill', text: `Poll ${index}` }),
        h('span', { 'data-role': 'wait-copy', text: message }),
      ]),
    ],
  )
  pushCard(quietCard)
}

function deltaCard(delta, index) {
  const initial = delta.kind === 'initial'
  const card = h(
    'article',
    {
      class: `delta-card ${initial ? 'delta-card--initial' : 'delta-card--delta'}` ,
      dataset: { kind: delta.kind },
    },
    [
      h('div', { class: 'delta-card__meta' }, [
        h('span', { class: initial ? 'pill' : 'pill pill--yellow', text: `Poll ${index}` }),
        h('span', { text: clock(new Date()) }),
        h('span', {
          class: initial ? 'pill pill--green' : 'pill pill--yellow',
          text: initial ? `${delta.wordCount} words cached` : `+${delta.wordCount} words`,
        }),
        h('span', { text: initial ? 'Baseline snapshot' : 'Delta since the cached transcript' }),
      ]),
      h('div', { class: 'turns' }, delta.segments.map((segment) => renderTurn(segment, initial))),
    ],
  )
  return card
}

function renderTurn(segment, initial) {
  const who = h('div', { class: 'turn__who' })
  if (segment.speaker) who.append(h('strong', { text: segment.speaker }))
  if (segment.time) who.append(h('span', { class: 'turn__time', text: segment.time }))
  if (!initial && segment.change === 'continued') {
    who.append(h('span', { class: 'tag tag--continued', text: 'Continued' }))
  }
  if (!initial && segment.change === 'revised') {
    who.append(h('span', { class: 'tag tag--revised', text: 'Revised' }))
  }

  const text = h('p', { class: 'turn__text' })
  if (!initial && segment.partial) {
    text.append(h('span', { class: 'ellipsis', 'aria-hidden': 'true', text: '… ' }))
  }
  text.append(document.createTextNode(segment.text))

  const body = h('div', {}, [who, text])
  if (!segment.speaker) return body

  return h('div', { class: 'turn' }, [
    h('div', { class: 'avatar', style: `background:${colorFor(segment.speaker)}`, text: initials(segment.speaker) }),
    body,
  ])
}

function showPending() {
  document.getElementById('empty-state')?.remove()
  if (document.getElementById('checking-card')) return
  const pending = h('article', { class: 'delta-card delta-card--pending', id: 'checking-card' }, [
    h('p', {
      class: 'pending-copy',
      text: mode === 'sample' ? 'Preparing the sample transcript…' : 'Asking Otter for the transcript…',
    }),
    h('div', { class: 'pending-bar' }),
  ])
  feed.prepend(pending)
}

function pushCard(card) {
  document.getElementById('empty-state')?.remove()
  document.getElementById('checking-card')?.remove()
  feed.prepend(card)
  clearBtn.hidden = feed.children.length === 0
}

function renderMeeting(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}
  const title = data.title || 'Untitled conversation'
  titleEl.textContent = title
  document.title = `${title} · Otter Live Deltas`
  eyebrowEl.textContent = mode === 'sample' ? 'Sample meeting' : 'Live transcript'
  summaryEl.textContent =
    data.abstract_summary || 'Otter did not include a summary. Deltas still come from the transcript.'

  const chips = []
  if (data.owner?.name) chips.push(h('span', { class: 'chip', text: data.owner.name }))
  if (data.created_at) chips.push(h('span', { class: 'chip', text: `Created ${shortWhen(data.created_at)}` }))
  chips.push(h('span', { class: 'chip', text: `${speechWordCount(cache?.transcript || '')} words in cache` }))
  if (typeof data.url === 'string' && data.url.startsWith('https://')) {
    chips.push(
      h('span', { class: 'chip' }, [
        h('a', { href: data.url, target: '_blank', rel: 'noreferrer', text: 'Open in Otter' }),
      ]),
    )
  }
  metaEl.replaceChildren(...chips)
  metaEl.hidden = chips.length === 0
}

function renderCache() {
  if (!cache) {
    cacheBody.replaceChildren(
      h('p', {
        text: 'No payload cached yet. The first successful poll is stored in memory and compared with the next one.',
      }),
    )
    return
  }
  const data = cache.payload?.data && typeof cache.payload.data === 'object' ? cache.payload.data : {}
  const stat = (label, value) => h('div', {}, [h('span', { text: label }), ` ${value}`])
  const stats = h('div', { class: 'cache__stats' }, [
    stat('Title', data.title || 'Untitled conversation'),
    stat('Cached', clock(new Date(cache.cachedAt))),
    stat('Retrieved', cache.retrievedAt ? shortWhen(cache.retrievedAt) : 'not provided'),
    stat('Transcript', `${speechWordCount(cache.transcript)} words`),
  ])
  const pre = h('pre', { text: JSON.stringify(cache.payload, null, 2) })
  const details = h('details', { class: 'cache-raw' }, [h('summary', { text: 'View cached payload' }), pre])
  cacheBody.replaceChildren(stats, details)
}

function stopPolling() {
  generation += 1
  mode = 'idle'
  if (timer) clearTimeout(timer)
  if (tickTimer) clearInterval(tickTimer)
  timer = null
  tickTimer = null
  inFlight = false
  document.getElementById('checking-card')?.remove()
  setBusy(false)
  setStatus('idle', 'Stopped')
  const prefix = lastNote ? `${lastNote} ` : ''
  countdownEl.textContent = cache
    ? `${prefix}Polling is stopped. The last payload is still cached.`
    : `${prefix}Polling is stopped.`
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (mode !== 'idle') return
  const key = apiKeyInput.value.trim()
  const parsed = parseConversationId(meetingInput.value)
  if (!key) {
    setFormError('Add an Otter API key to start polling.')
    apiKeyInput.focus()
    return
  }
  if (!parsed.id) {
    setFormError(parsed.error)
    meetingInput.focus()
    return
  }
  remember()
  conversationId = parsed.id
  begin('live')
})

stopBtn.addEventListener('click', stopPolling)

sampleBtn.addEventListener('click', () => {
  if (mode !== 'idle') return
  setFormError('')
  begin('sample')
})

forgetBtn.addEventListener('click', () => {
  if (mode !== 'idle') return
  apiKeyInput.value = ''
  meetingInput.value = ''
  updateIdHint()
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing else to clear.
  }
  setFormError('')
})

clearBtn.addEventListener('click', () => {
  if (mode !== 'idle') return
  cache = null
  quietCard = null
  pollIndex = 0
  lastNote = ''
  renderCache()
  titleEl.textContent = 'Only the new words'
  summaryEl.textContent =
    'Poll a conversation every 15 seconds. Each response is cached, and the next card shows just the delta.'
  eyebrowEl.textContent = 'Live transcript'
  metaEl.hidden = true
  metaEl.replaceChildren()
  document.title = 'Otter Live Deltas'
  showEmpty()
  countdownEl.textContent = ''
  setStatus('idle', 'Idle')
})

toggleKeyBtn.addEventListener('click', () => {
  const showing = apiKeyInput.type === 'text'
  apiKeyInput.type = showing ? 'password' : 'text'
  toggleKeyBtn.textContent = showing ? 'Show' : 'Hide'
  toggleKeyBtn.setAttribute('aria-label', showing ? 'Show API key' : 'Hide API key')
})

meetingInput.addEventListener('input', () => {
  updateIdHint()
  setFormError('')
})
apiKeyInput.addEventListener('input', () => setFormError(''))

restore()
updateIdHint()
showEmpty()
setStatus('idle', 'Idle')
