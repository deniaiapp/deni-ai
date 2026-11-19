import type { ComputerState, ShellRecord } from "../types";

type Listener = (state: ComputerState) => void;

const g = globalThis as typeof globalThis & {
  __deniEvents?: Map<
    string,
    { listeners: Set<Listener>; last: ComputerState | null; shells: ShellRecord[] }
  >;
};

function bus(userId: string) {
  if (!g.__deniEvents) g.__deniEvents = new Map();
  let value = g.__deniEvents.get(userId);
  if (!value) {
    value = { listeners: new Set(), last: null, shells: [] };
    g.__deniEvents.set(userId, value);
  }
  return value;
}

export function emitComputer(userId: string, state: ComputerState) {
  const b = bus(userId);
  b.last = state;
  for (const listener of b.listeners) listener(state);
}

export function subscribeComputer(userId: string, listener: Listener): () => void {
  const b = bus(userId);
  b.listeners.add(listener);
  return () => b.listeners.delete(listener);
}

export function lastComputer(userId: string): ComputerState | null {
  return bus(userId).last;
}

export function pushShell(userId: string, record: ShellRecord) {
  const b = bus(userId);
  b.shells = [record, ...b.shells].slice(0, 80);
}

export function listShells(userId: string): ShellRecord[] {
  return bus(userId).shells;
}
