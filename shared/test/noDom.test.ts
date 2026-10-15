import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('shared/ purity', () => {
  it('does not import PixiJS or use DOM globals', () => {
    const src = join(import.meta.dirname, '..', 'src');
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/from ['"]pixi/);
      expect(text, f).not.toMatch(/\b(window|document|navigator|HTMLElement|requestAnimationFrame)\b/);
    }
  });
});
