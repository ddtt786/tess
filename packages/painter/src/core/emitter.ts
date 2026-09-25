export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter used by every painter surface. */
export class Emitter<Events extends object> {
  private map = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(type, ((payload: Events[K]) => {
      off();
      fn(payload);
    }) as Listener<Events[K]>);
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.map.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Listener<Events[K]>)(payload);
  }

  clearListeners(): void {
    this.map.clear();
  }
}
