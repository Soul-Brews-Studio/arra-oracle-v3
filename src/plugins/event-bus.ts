export type PluginErrorPhase = 'load' | 'init' | 'runtime' | 'destroy';

export interface PluginEventMap {
  'plugin:loaded': {
    plugin: string;
    dir?: string;
  };
  'plugin:error': {
    plugin: string;
    phase: PluginErrorPhase;
    error: unknown;
    message?: string;
  };
  'plugin:destroyed': {
    plugin: string;
    reason?: 'shutdown' | 'reload' | 'disabled';
  };
}

export type PluginEventName = keyof PluginEventMap;
export type PluginEventHandler<EventName extends PluginEventName> = (
  event: PluginEventMap[EventName],
) => void | Promise<void>;

type AnyPluginEventHandler = (event: PluginEventMap[PluginEventName]) => void | Promise<void>;

export class PluginEventBus {
  private readonly listeners = new Map<PluginEventName, Set<AnyPluginEventHandler>>();

  on<EventName extends PluginEventName>(
    eventName: EventName,
    handler: PluginEventHandler<EventName>,
  ): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<AnyPluginEventHandler>();
    listeners.add(handler as AnyPluginEventHandler);
    this.listeners.set(eventName, listeners);
    return () => this.off(eventName, handler);
  }

  off<EventName extends PluginEventName>(
    eventName: EventName,
    handler: PluginEventHandler<EventName>,
  ): void {
    this.listeners.get(eventName)?.delete(handler as AnyPluginEventHandler);
  }

  async emit<EventName extends PluginEventName>(
    eventName: EventName,
    event: PluginEventMap[EventName],
  ): Promise<number> {
    const listeners = [...(this.listeners.get(eventName) ?? [])];
    for (const listener of listeners) await listener(event);
    return listeners.length;
  }
}

export const pluginEventBus = new PluginEventBus();
