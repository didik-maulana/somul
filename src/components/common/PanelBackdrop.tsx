import { useEffect, useState, type FC } from 'react';

import { onPanelShown } from '@/lib/ipc';

/**
 * The panel's decorative mesh: two drifting gradients and four expanding rings.
 *
 * Keyed on a counter that ticks whenever the panel comes back on screen. A tray panel is hidden
 * far more often than it is shown, and WebKit throttles animations on an occluded window rather
 * than pausing them cleanly — reopening would then show a frame from wherever the timeline had
 * been left, holding it until the animation caught up. Remounting restarts every timeline from
 * zero, which costs nothing here because none of these elements hold state.
 *
 * The tray tells us when that happens. The panel is shown by the Rust side rather than by the
 * user clicking into it, and an accessory window that never takes key focus fires neither
 * `focus` nor `visibilitychange` — which is why listening for those alone left the mesh frozen.
 *
 * `pointer-events-none` and behind everything: it is the one part of the panel that is pure
 * decoration, so it must never be able to take a click or raise a scroll.
 */
export const PanelBackdrop: FC = () => {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const restart = () => {
      setEpoch((previous) => previous + 1);
    };

    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    // Swallowed rather than surfaced: the mesh is decoration, and a panel that cannot subscribe
    // to the tray still has to render. It simply stops restarting itself.
    void onPanelShown(restart)
      .then((stop) => {
        if (isCancelled) {
          stop();
          return;
        }

        unlisten = stop;
      })
      .catch(() => undefined);

    // Kept as a second trigger for the paths the tray does not own: a display waking, or the
    // window being revealed by something other than the tray icon.
    window.addEventListener('focus', restart);

    return () => {
      isCancelled = true;
      unlisten?.();
      window.removeEventListener('focus', restart);
    };
  }, []);

  return (
    <div
      key={epoch}
      aria-hidden="true"
      data-testid="panel-backdrop"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl"
    >
      <div className="animated-circular-gradient absolute -top-20 -left-20 size-72 rounded-full opacity-25 blur-3xl" />
      <div className="animated-circular-gradient-secondary absolute -right-24 -bottom-24 size-80 rounded-full opacity-20 blur-3xl" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="audio-circle-ring audio-circle-1 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-2 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-3 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-4 absolute size-60 rounded-full blur-xs" />
      </div>
    </div>
  );
};
