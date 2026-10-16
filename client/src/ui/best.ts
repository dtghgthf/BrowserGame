import { CAMPAIGN_LEGS, dailyLabel, type GameMode } from '@lw/shared';

/** Best results on this device (localStorage): legs reached per mode, the daily voyage per day. */
const KEY = 'lw.best.v1';

interface Best {
  campaign?: { legs: number; coins: number };
  daily?: { day: string; legs: number; coins: number };
  single?: { arrived: number };
}

function load(): Best {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Best;
  } catch {
    return {};
  }
}

function save(b: Best): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
}

/** Remembers the end of a run. Returns true if it is a new best. */
export function recordRun(mode: GameMode, legs: number, coins: number, now = new Date()): boolean {
  const b = load();
  let best = false;
  if (mode === 'campaign') {
    if (!b.campaign || legs > b.campaign.legs || (legs === b.campaign.legs && coins > b.campaign.coins)) {
      b.campaign = { legs, coins };
      best = true;
    }
  } else if (mode === 'daily') {
    const day = dailyLabel(now);
    if (!b.daily || b.daily.day !== day || legs > b.daily.legs || (legs === b.daily.legs && coins > b.daily.coins)) {
      b.daily = { day, legs, coins };
      best = true;
    }
  } else if (legs > 0) {
    b.single = { arrived: (b.single?.arrived ?? 0) + 1 };
    best = true;
  }
  save(b);
  return best;
}

/** One line for the lobby. */
export function bestLine(now = new Date()): string {
  const b = load();
  const parts: string[] = [];
  if (b.campaign) parts.push(`Kampagne: ${b.campaign.legs}/${CAMPAIGN_LEGS} Etappen`);
  if (b.daily && b.daily.day === dailyLabel(now)) parts.push(`Tagesfahrt heute: ${b.daily.legs}/${CAMPAIGN_LEGS}`);
  if (b.single) parts.push(`Leuchtturm erreicht: ${b.single.arrived}×`);
  return parts.length ? `Bestleistung · ${parts.join(' · ')}` : '';
}

/** Shareable text for the daily voyage. */
export function dailyShareText(legs: number, coins: number, won: boolean, now = new Date()): string {
  return `Leuchtturmwärter · Tagesfahrt ${dailyLabel(now)}: ${won ? 'Leuchtturm erreicht!' : `${legs}/${CAMPAIGN_LEGS} Etappen`} · ${coins} Münzen`;
}

/** The end of a run as a line to share ("Tagesfahrt 16.10.: 4/6 Etappen, 212 Münzen"). */
export function resultText(mode: GameMode, legs: number, coins: number, won: boolean, now = new Date()): string {
  const what = mode === 'daily' ? `Tagesfahrt ${now.getUTCDate()}.${now.getUTCMonth() + 1}.` : 'Kampagne';
  const end = won ? `Leuchtturm erreicht (${legs}/${CAMPAIGN_LEGS} Etappen)` : `${legs}/${CAMPAIGN_LEGS} Etappen`;
  return `Leuchtturmwärter · ${what}: ${end}, ${coins} Münzen`;
}

/** A small card at the bottom of the screen: the result and a button to share it. */
export function showShareCard(text: string, url: string): void {
  document.querySelector('.share-card')?.remove();
  const el = document.createElement('div');
  el.className = 'share-card allow-touch';
  const line = document.createElement('span');
  line.textContent = text;
  const share = document.createElement('button');
  share.className = 'lobby-btn primary';
  share.textContent = 'Ergebnis teilen';
  const close = document.createElement('button');
  close.className = 'lobby-btn';
  close.textContent = '×';
  el.append(line, share, close);
  document.body.appendChild(el);
  const timer = setTimeout(() => el.remove(), 30000);
  close.addEventListener('click', () => {
    clearTimeout(timer);
    el.remove();
  });
  share.addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Leuchtturmwärter', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      share.textContent = 'Kopiert!';
    } catch {
      share.textContent = 'Kopieren ging nicht';
    }
  });
}

