import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countWords,
  diffText,
  diffTranscript,
  extractTranscript,
  parseTranscript,
} from './delta.js'
import { parseConversationId } from './meeting.js'
import { SAMPLE_TRANSCRIPTS } from './sample.js'

const OFFICIAL = `Jane Doe  00:00
Thanks everyone for joining today. I'd love to understand how your team handles customer calls and where Otter might help.

Alex Taylor  00:07
Right now we take notes manually, and we often miss details or lose track of follow-ups after the meeting.

Jane Doe  00:14
That makes sense. Otter can automatically capture the conversation, generate summaries, and highlight key action items.

Alex Taylor  00:21
That would be really valuable for us, especially for onboarding new reps and improving consistency.

Jane Doe  00:28
Great—I'll send a follow-up with pricing options and a proposed rollout timeline.

Alex Taylor  00:35
Sounds good. We'll review internally and get back to you this week.`

describe('parseTranscript', () => {
  it('splits the documented Otter transcript into speaker turns', () => {
    const segments = parseTranscript(OFFICIAL)
    assert.equal(segments.length, 6)
    assert.deepEqual(segments[0], {
      speaker: 'Jane Doe',
      time: '00:00',
      text: "Thanks everyone for joining today. I'd love to understand how your team handles customer calls and where Otter might help.",
    })
    assert.equal(segments[5].speaker, 'Alex Taylor')
    assert.equal(segments[5].time, '00:35')
  })

  it('accepts the short documented example with a leading space', () => {
    const segments = parseTranscript('Sam  00:15 \n Welcome to project launch meeting!\n')
    assert.equal(segments.length, 1)
    assert.equal(segments[0].speaker, 'Sam')
    assert.equal(segments[0].time, '00:15')
    assert.equal(segments[0].text, 'Welcome to project launch meeting!')
  })

  it('does not treat a sentence that mentions a time as a speaker', () => {
    const segments = parseTranscript(`Sam  00:15
See you at 10:00 tomorrow.`)
    assert.equal(segments.length, 1)
    assert.equal(segments[0].text, 'See you at 10:00 tomorrow.')
  })
})

describe('diffTranscript', () => {
  it('treats the first snapshot as the full baseline', () => {
    const delta = diffTranscript('', OFFICIAL)
    assert.equal(delta.kind, 'initial')
    assert.equal(delta.segments.length, 6)
    assert.ok(delta.wordCount > 40)
  })

  it('returns only turns that were not in the cache', () => {
    const previous = OFFICIAL.split('\n\n').slice(0, 2).join('\n\n')
    const delta = diffTranscript(previous, OFFICIAL)
    assert.equal(delta.kind, 'delta')
    assert.deepEqual(
      delta.segments.map((segment) => segment.time),
      ['00:14', '00:21', '00:28', '00:35'],
    )
    assert.ok(delta.segments.every((segment) => segment.change === 'new'))
  })

  it('returns only the words added to an in-progress turn', () => {
    const previous = `Avery Brooks  00:09
Design is locked. The empty state is still in review.`
    const next = `Avery Brooks  00:09
Design is locked. The empty state is still in review. I will post the final frames after this call.`
    const delta = diffTranscript(previous, next)
    assert.equal(delta.kind, 'delta')
    assert.equal(delta.segments.length, 1)
    assert.equal(delta.segments[0].change, 'continued')
    assert.equal(delta.segments[0].text, 'I will post the final frames after this call.')
    assert.equal(delta.segments[0].partial, true)
  })

  it('returns only a corrected word when Otter rewrites a turn', () => {
    const previous = 'The beta group finished onboarding yesterday.'
    const next = 'The beta group finished onboarding this morning.'
    const change = diffText(previous, next)
    assert.equal(change.type, 'rewrite')
    assert.equal(change.text, 'this morning')

    const delta = diffTranscript(
      `Priya Shah  00:08\n${previous}`,
      `Priya Shah  00:08\n${next}`,
    )
    assert.equal(delta.segments[0].change, 'revised')
    assert.equal(delta.segments[0].text, 'this morning')
  })

  it('ignores an identical poll and whitespace-only changes', () => {
    assert.equal(diffTranscript(OFFICIAL, OFFICIAL).kind, 'unchanged')
    assert.equal(diffTranscript(OFFICIAL, `${OFFICIAL}\n\n`).kind, 'unchanged')
    assert.equal(diffTranscript('', '').kind, 'unchanged')
  })

  it('keeps a new middle turn without repeating speech that was already cached', () => {
    const previous = `Jordan Lee  00:00
Welcome in.

Riley Chen  00:21
I will take the follow-up email.`
    const next = `Jordan Lee  00:00
Welcome in.

Avery Brooks  00:09
Design is locked.

Riley Chen  00:21
I will take the follow-up email.`
    const delta = diffTranscript(previous, next)
    assert.equal(delta.segments.length, 1)
    assert.equal(delta.segments[0].speaker, 'Avery Brooks')
    assert.equal(delta.segments[0].change, 'new')
  })

  it('does not repeat a turn when Otter only renames the speaker', () => {
    const previous = `Speaker 1  00:12
The rollout timeline still depends on the security review.`
    const next = `Riley Chen  00:12
The rollout timeline still depends on the security review.`
    assert.equal(diffTranscript(previous, next).kind, 'unchanged')
  })

  it('falls back to a text suffix when the transcript has no speaker labels', () => {
    const delta = diffTranscript(
      'Welcome to the launch meeting.',
      'Welcome to the launch meeting. We are ready to ship.',
    )
    assert.equal(delta.kind, 'delta')
    assert.equal(delta.segments[0].text, 'We are ready to ship.')
    assert.equal(delta.segments[0].change, 'continued')
  })

  it('walks the sample meeting one poll at a time', () => {
    let cache = ''
    const kinds = []
    for (const frame of SAMPLE_TRANSCRIPTS) {
      const delta = diffTranscript(cache, frame)
      kinds.push(delta.kind)
      if (delta.kind !== 'unchanged') {
        assert.ok(delta.wordCount > 0)
        assert.ok(delta.segments.every((segment) => segment.text))
      }
      cache = frame
    }
    assert.deepEqual(kinds, ['initial', 'delta', 'delta', 'delta', 'unchanged'])
    const continued = diffTranscript(SAMPLE_TRANSCRIPTS[0], SAMPLE_TRANSCRIPTS[1])
    assert.equal(continued.segments.length, 1)
    assert.match(continued.segments[0].text, /^I will post the final frames/)
    assert.doesNotMatch(continued.segments[0].text, /Design is locked/)
  })
})

describe('extractTranscript', () => {
  it('reads relationships.transcript.content from a conversation payload', () => {
    const content = extractTranscript({
      meta: { retrieved_at: '2025-07-31T12:00:00Z' },
      data: {
        id: 'conversation_id',
        title: 'product launch meeting',
        relationships: {
          transcript: {
            content: 'Sam  00:15\nWelcome to project launch meeting!\n',
            format: 'txt',
          },
        },
      },
    })
    assert.match(content, /Welcome to project launch meeting/)
  })

  it('returns an empty string when the transcript is not included yet', () => {
    assert.equal(extractTranscript({ data: { id: 'abc', relationships: {} } }), '')
    assert.equal(extractTranscript(null), '')
  })
})

describe('countWords', () => {
  it('counts words after trimming', () => {
    assert.equal(countWords('  one two\nthree '), 3)
    assert.equal(countWords(''), 0)
  })
})

describe('parseConversationId', () => {
  it('reads the id from an Otter meeting URL', () => {
    assert.deepEqual(parseConversationId('https://otter.ai/u/conversation_id'), {
      id: 'conversation_id',
      error: null,
    })
    assert.equal(
      parseConversationId('https://otter.ai/u/AbC_123?utm_source=share').id,
      'AbC_123',
    )
    assert.equal(parseConversationId('https://app.otter.ai/u/meeting-9/').id, 'meeting-9')
    assert.equal(
      parseConversationId('https://api.otter.ai/v1/conversations/from-api').id,
      'from-api',
    )
  })

  it('accepts a raw conversation id', () => {
    assert.equal(parseConversationId('  a1B2c3D4e5F6g7H8 ').id, 'a1B2c3D4e5F6g7H8')
  })

  it('rejects links that are not Otter conversations', () => {
    assert.equal(parseConversationId('').id, null)
    assert.match(parseConversationId('https://example.com/u/nope').error, /otter\.ai/)
    assert.equal(parseConversationId('https://otter.ai/pricing').id, null)
  })
})
