export const MAX_MOD_EVENT_NAME_LENGTH = 128;
export const MAX_MOD_EVENT_PAYLOAD_BYTES = 16 * 1024;
export const MAX_MOD_EVENT_SUBSCRIPTIONS = 32;
export const MAX_MOD_EVENT_PUBLISHES_PER_SECOND = 10;

const EVENT_NAME_PATTERN =
  /^[a-z0-9]+(?:[.-][a-z0-9]+)*:[a-z0-9][a-z0-9._-]{0,63}$/;

export function isValidModEventName(
  eventName: unknown,
  publisherId?: string,
): eventName is string {
  if (
    typeof eventName !== "string" ||
    eventName.length > MAX_MOD_EVENT_NAME_LENGTH ||
    !EVENT_NAME_PATTERN.test(eventName)
  ) {
    return false;
  }

  return publisherId === undefined || eventName.startsWith(`${publisherId}:`);
}

export function serializeModEventPayload(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_MOD_EVENT_PAYLOAD_BYTES
    ) {
      return undefined;
    }
    return serialized;
  } catch {
    return undefined;
  }
}
