/**
 * A fictional meeting that grows across polls, so the delta cards can be
 * previewed without an Otter API key. Speakers and words are made up.
 */

export const SAMPLE_TRANSCRIPTS = [
  `Jordan Lee  00:00
Welcome in. This is the launch sync. I want a clear picture of what is still open before Thursday.

Avery Brooks  00:09
Design is locked. The empty state for the summary tab is the last screen still in review.`,

  `Jordan Lee  00:00
Welcome in. This is the launch sync. I want a clear picture of what is still open before Thursday.

Avery Brooks  00:09
Design is locked. The empty state for the summary tab is the last screen still in review. I will post the final frames after this call.`,

  `Jordan Lee  00:00
Welcome in. This is the launch sync. I want a clear picture of what is still open before Thursday.

Avery Brooks  00:09
Design is locked. The empty state for the summary tab is the last screen still in review. I will post the final frames after this call.

Riley Chen  00:21
I will take the follow-up email. The customer asked for pricing and a rollout timeline, and I can send both today.`,

  `Jordan Lee  00:00
Welcome in. This is the launch sync. I want a clear picture of what is still open before Thursday.

Avery Brooks  00:09
Design is locked. The empty state for the summary tab is the last screen still in review. I will post the final mockups after this call.

Riley Chen  00:21
I will take the follow-up email. The customer asked for pricing and a rollout timeline, and I can send both today. I will also attach the one-page overview.

Jordan Lee  00:34
Perfect. Let's end with owners: Avery on the mockups, Riley on the email, and I will update the channel notes.`,

  `Jordan Lee  00:00
Welcome in. This is the launch sync. I want a clear picture of what is still open before Thursday.

Avery Brooks  00:09
Design is locked. The empty state for the summary tab is the last screen still in review. I will post the final mockups after this call.

Riley Chen  00:21
I will take the follow-up email. The customer asked for pricing and a rollout timeline, and I can send both today. I will also attach the one-page overview.

Jordan Lee  00:34
Perfect. Let's end with owners: Avery on the mockups, Riley on the email, and I will update the channel notes.`,
]

export function samplePayload(frameIndex) {
  const index = Math.min(Math.max(frameIndex, 0), SAMPLE_TRANSCRIPTS.length - 1)
  const content = SAMPLE_TRANSCRIPTS[index]
  return {
    meta: {
      retrieved_at: new Date().toISOString(),
    },
    data: {
      id: 'sample_launch_sync',
      title: 'Launch sync (sample)',
      url: 'https://otter.ai/u/sample_launch_sync',
      owner: {
        id: 'sample_owner',
        name: 'Jordan Lee',
        first_name: 'Jordan',
        last_name: 'Lee',
        email: 'jordan@example.com',
      },
      created_at: '2026-09-29T15:00:00Z',
      abstract_summary:
        'The group locked remaining launch work: final mockups, a customer follow-up, and channel notes.',
      relationships: {
        transcript: {
          content,
          format: 'txt',
        },
      },
    },
  }
}
