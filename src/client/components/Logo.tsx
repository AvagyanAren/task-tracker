import { useId } from 'react';

/** Tempo mark: a metronome - the beat that keeps time. */
export function Logo({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <path d="M24 34 31 8" stroke="#000" strokeWidth="8" strokeLinecap="round" />
        </mask>
      </defs>
      <path d="M15.5 41 20.5 15h7l5 26z" stroke="var(--accent-2)" strokeWidth="3" strokeLinejoin="round" mask={`url(#${id})`} />
      <path d="M24 34 31 8" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="27.6" cy="21.5" r="3.4" fill="var(--accent-2)" />
    </svg>
  );
}
