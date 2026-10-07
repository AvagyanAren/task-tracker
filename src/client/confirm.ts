export interface ConfirmRequest {
  title: string;
  text?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let handler: ((r: ConfirmRequest) => void) | null = null;

/** Called by <ConfirmHost/> so confirmDialog() can show the in-app modal. */
export function registerConfirmHost(h: ((r: ConfirmRequest) => void) | null) {
  handler = h;
}

/** Styled replacement for window.confirm; resolves true when the user confirms. */
export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!handler) return resolve(window.confirm(opts.text ? `${opts.title}\n${opts.text}` : opts.title));
    handler({ ...opts, resolve });
  });
}
