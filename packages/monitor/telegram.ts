import type { MarketEvent } from '../core/types';

export async function sendAlert(
  event: MarketEvent,
  telegram: { botToken: string; chatId: string },
) {
  if (!telegram.botToken || !telegram.chatId) return false;

  const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegram.chatId,
      text: formatEvent(event),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${response.statusText}`);
  }

  return true;
}

export function formatEvent(event: MarketEvent): string {
  const time = new Date(event.candleCloseTime).toISOString().slice(11, 16);

  if (event.type === 'CONFIRMED_SIGNAL') {
    const rr = event.entry && event.stop && event.target
      ? Math.abs(event.target - event.entry) / Math.abs(event.entry - event.stop)
      : 0;

    return `${event.coin} ${event.direction} signal (score ${event.score ?? 0}) - entry ${fmt(event.entry)}, stop ${fmt(event.stop)}, target ${fmt(event.target)} (R:R ${rr.toFixed(1)})`;
  }

  if (event.type === 'LEVEL_TOUCH') {
    return `${event.coin} touched ${event.levelName} ${fmt(event.levelPrice)} - price rejected and closed at ${fmt(event.price)} (UTC ${time})`;
  }

  return `${event.coin} broke ${event.levelName} ${fmt(event.levelPrice)} - closed at ${fmt(event.price)} (UTC ${time})`;
}

function fmt(value: number | undefined) {
  if (value === undefined) return 'n/a';
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
