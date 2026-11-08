// Moving active tabs between windows makes Chrome select a neighbouring tab.
// That automatic selection must never be treated as a click on a stack cover.
export function createFocusGuard() {
  const windows = new Map();
  return {
    has: windowId => (windows.get(windowId) || 0) > 0,
    async run(windowId, operation) {
      windows.set(windowId, (windows.get(windowId) || 0) + 1);
      try { return await operation(); }
      finally {
        // Tab events are delivered before the next task, including events from
        // the last awaited tabs.move/update call.
        await new Promise(resolve => setTimeout(resolve, 0));
        const remaining = windows.get(windowId) - 1;
        if (remaining) windows.set(windowId, remaining); else windows.delete(windowId);
      }
    },
  };
}
