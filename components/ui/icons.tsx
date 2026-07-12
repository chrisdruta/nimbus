import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

export const IconPause = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" />
  </svg>
);

export const IconPrev = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 6a1 1 0 0 1 2 0v5l9.3-5.9A1 1 0 0 1 20 6v12a1 1 0 0 1-1.7.9L9 13v5a1 1 0 0 1-2 0z" transform="scale(-1,1) translate(-24,0)" />
  </svg>
);

export const IconNext = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 6a1 1 0 0 1 2 0v5l9.3-5.9A1 1 0 0 1 20 6v12a1 1 0 0 1-1.7.9L9 13v5a1 1 0 0 1-2 0z" />
  </svg>
);

export const IconShuffle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="M4 4l5 5" />
  </svg>
);

export const IconRepeat = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

export const IconVolume = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.6 5.4a9 9 0 0 1 0 13.2" />
  </svg>
);

export const IconMute = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <line x1="15" y1="9" x2="21" y2="15" />
    <line x1="21" y1="9" x2="15" y2="15" />
  </svg>
);

export const IconQueue = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="3" y1="6" x2="13" y2="6" />
    <line x1="3" y1="12" x2="13" y2="12" />
    <line x1="3" y1="18" x2="9" y2="18" />
    <path d="M16 12v6.5a2.5 2.5 0 1 0 2 2.45V8l4 2" transform="translate(0,-3)" />
  </svg>
);

export const IconSpark = (p: IconProps) => (
  // mini-visualizer toggle: three bars
  <svg {...base(p)}>
    <line x1="6" y1="20" x2="6" y2="12" />
    <line x1="12" y1="20" x2="12" y2="5" />
    <line x1="18" y1="20" x2="18" y2="9" />
  </svg>
);

export const IconExpand = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-15" transform="translate(0,0)" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
    <path d="M3 15v6h6" />
  </svg>
);

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
    <path d="M16 6l-4-4-4 4" />
    <path d="M12 2v13" />
  </svg>
);

export const IconHeart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 1 1 7.5-6.6 5 5 0 1 1 7.5 6.6z" />
  </svg>
);

export const IconCloud = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98 6.5 6.5 0 0 1 12.6 1.02A4 4 0 0 1 18 19z" />
  </svg>
);

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="5" y1="5" x2="19" y2="19" />
    <line x1="19" y1="5" x2="5" y2="19" />
  </svg>
);

export const IconChevronUp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);
