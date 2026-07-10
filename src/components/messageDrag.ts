export const MESSAGE_DRAG_MIME = 'application/x-better-email-message-ids';

function normalizeMessageIds(messageIds: number[]): number[] {
  return [...new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))];
}

export function writeMessageDragPayload(dataTransfer: DataTransfer, messageIds: number[]): number[] {
  const normalizedIds = normalizeMessageIds(messageIds);
  if (normalizedIds.length === 0) return [];
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(MESSAGE_DRAG_MIME, JSON.stringify(normalizedIds));
  return normalizedIds;
}

export function hasMessageDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(MESSAGE_DRAG_MIME);
}

export function readMessageDragPayload(dataTransfer: DataTransfer): number[] {
  try {
    const parsed = JSON.parse(dataTransfer.getData(MESSAGE_DRAG_MIME));
    return Array.isArray(parsed) ? normalizeMessageIds(parsed) : [];
  } catch {
    return [];
  }
}
