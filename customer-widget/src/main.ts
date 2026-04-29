import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Widget } from './Widget';
import { logger } from './logger';
import type { WidgetConfig } from './types';

const ROOT_ID = 'ah-chat-root';
let activeRoot: Root | null = null;
let mountedEl: HTMLElement | null = null;

function ensureContainer(selector?: string): HTMLElement {
  if (selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

export function mount(config: WidgetConfig = {}): void {
  if (activeRoot) return;
  const container = ensureContainer(config.rootSelector);
  mountedEl = container;
  activeRoot = createRoot(container);
  activeRoot.render(createElement(Widget, { config }));
  logger.info('widget.mount');
}

export function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
    logger.info('widget.unmount');
  }
  if (mountedEl && mountedEl.id === ROOT_ID && !mountedEl.hasChildNodes()) {
    mountedEl.remove();
    mountedEl = null;
  }
}

function autoMount(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.AHChat = Object.assign(window.AHChat || {}, { mount, unmount });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  } else {
    mount();
  }
}

autoMount();

export { Widget };
export type { WidgetConfig };
