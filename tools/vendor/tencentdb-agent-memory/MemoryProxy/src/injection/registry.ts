/**
 * HookRegistry implementation.
 * Manages registration, unregistration, and priority-sorted retrieval of injection hooks.
 */

import type { HookRegistry, InjectionHook, InjectionPoint } from "./types.js";

/**
 * Default HookRegistry implementation.
 */
export class HookRegistryImpl implements HookRegistry {
  private hooks: InjectionHook[] = [];

  register(hook: InjectionHook): void {
    const existing = this.hooks.find((h) => h.id === hook.id);
    if (existing) {
      throw new Error(`Hook with id "${hook.id}" is already registered`);
    }
    this.hooks.push(hook);
  }

  unregister(hookId: string): void {
    this.hooks = this.hooks.filter((h) => h.id !== hookId);
  }

  getHooks(point: InjectionPoint): InjectionHook[] {
    return this.hooks
      .filter((h) => h.point === point)
      .sort((a, b) => a.priority - b.priority);
  }

  getAll(): InjectionHook[] {
    return [...this.hooks];
  }
}
