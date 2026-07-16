interface IconProps {
  className?: string;
}

const SHARED_PROPS = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8v8.5a.5.5 0 0 0 .5.5H8v-4.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V17h2.5a.5.5 0 0 0 .5-.5V8" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v7A1.5 1.5 0 0 1 15.5 13H9l-3.5 3.5V13H4.5A1.5 1.5 0 0 1 3 11.5z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <circle cx="10" cy="10" r="2.75" />
      <path d="M10 3v2.1M10 14.9V17M17 10h-2.1M5.1 10H3M14.6 5.4l-1.5 1.5M6.9 13.1l-1.5 1.5M14.6 14.6l-1.5-1.5M6.9 6.9 5.4 5.4" />
    </svg>
  );
}

export function DebugIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <rect x="3" y="4" width="14" height="10" rx="1.5" />
      <path d="M7 17h6M10 14v3M6.5 7.5l2 2-2 2M11 11.5h2.5" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...SHARED_PROPS} className={className}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}
