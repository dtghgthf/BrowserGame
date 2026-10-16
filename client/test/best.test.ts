import { describe, expect, it } from 'vitest';
import { resultText } from '../src/ui/best';

describe('result text', () => {
  it('names the daily voyage by its day and counts legs and coins', () => {
    const day = new Date(Date.UTC(2026, 9, 16, 12));
    expect(resultText('daily', 4, 212, false, day)).toBe('Leuchtturmwärter · Tagesfahrt 16.10.: 4/6 Etappen, 212 Münzen');
    expect(resultText('campaign', 6, 480, true, day)).toBe('Leuchtturmwärter · Kampagne: Leuchtturm erreicht (6/6 Etappen), 480 Münzen');
  });
});
