/** Collision-resistant short id. Random-based so ids survive reload/hydration
 *  without a shared counter to reset. */
export const uid = (): string =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
