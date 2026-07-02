const CONNECTED_THRESHOLD_MS = 15_000;

interface Esp32State {
  pressCount: number;
  lastSeenAt: number | null;
}

const state: Esp32State = {
  pressCount: 0,
  lastSeenAt: null,
};

export function recordHeartbeat(): void {
  state.lastSeenAt = Date.now();
}

export function recordButtonPress(): number {
  recordHeartbeat();
  state.pressCount += 1;
  return state.pressCount;
}

export function resetPressCount(): void {
  state.pressCount = 0;
}

export function getEsp32Status(): {
  connected: boolean;
  pressCount: number;
  lastSeenAt: string | null;
} {
  const connected =
    state.lastSeenAt !== null &&
    Date.now() - state.lastSeenAt < CONNECTED_THRESHOLD_MS;

  return {
    connected,
    pressCount: state.pressCount,
    lastSeenAt:
      state.lastSeenAt !== null ? new Date(state.lastSeenAt).toISOString() : null,
  };
}
