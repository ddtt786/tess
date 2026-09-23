/**
 * @fileoverview Giving the page a moment between long steps.
 *
 * `setTimeout(0)` is held back to once a second in a background tab, and
 * `scheduler.yield()` can be deferred there as well. A message through a
 * channel is neither, and still lets the page paint and take input between steps.
 */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}
