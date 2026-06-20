import { renderDay, dayKey, mergeMessages } from '../chat-day';
import type { NormalizedMessage } from '../types';

const msg = (over: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: 'm1',
  tsMs: Date.parse('2026-06-11T09:41:00Z'),
  sender: 'Alice',
  text: 'morning!',
  system: false,
  ...over,
});

describe('chat-day', () => {
  it('buckets a timestamp into a YYYY-MM-DD local day key', () => {
    // Asserted against the runner's local tz via a fixed offset-free midpoint.
    expect(dayKey(Date.parse('2026-06-11T12:00:00'))).toBe('2026-06-11');
  });

  it('merges by id, keeping one copy and sorting by ts', () => {
    const a = msg({ id: 'm1', tsMs: 2 });
    const b = msg({ id: 'm2', tsMs: 1, sender: 'Bob', text: 'hi' });
    const merged = mergeMessages([a], [b, { ...a }]);
    expect(merged.map((m) => m.id)).toEqual(['m2', 'm1']);
  });

  it('renders text, replies, media and system lines', () => {
    const md = renderDay('Family', [
      msg({ id: 'm1', text: 'morning!' }),
      msg({
        id: 'm2',
        sender: 'Bob',
        text: 'on my way',
        quote: { sender: 'Alice', snippet: 'morning!' },
      }),
      msg({ id: 'm3', sender: 'Bob', text: '', media: { kind: 'image' } }),
      msg({
        id: 'm4',
        sender: null,
        system: true,
        text: 'Messages are end-to-end encrypted.',
      }),
    ]);
    expect(md).toContain('Alice: morning!');
    expect(md).toContain('↳re Alice: morning!');
    expect(md).toContain('[image]');
    expect(md).toContain('_Messages are end-to-end encrypted._');
  });
});
