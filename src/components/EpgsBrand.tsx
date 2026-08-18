import { APP_VERSION } from "../lib/appVersion";

interface EpgsAppIconProps {
  size?: number;
  className?: string;
  title?: string;
}

export function EpgsAppIcon({ size = 36, className, title = "EPGS" }: EpgsAppIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="epgs-icon-bg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#101010" />
          <stop offset="1" stopColor="#181818" />
        </linearGradient>
        <linearGradient id="epgs-icon-ring" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#39ff14" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#00ced1" stopOpacity="0.75" />
          <stop offset="1" stopColor="#39ff14" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="epgs-icon-accent" x1="18" y1="18" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#39ff14" />
          <stop offset="1" stopColor="#00ced1" />
        </linearGradient>
        <filter id="epgs-icon-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#epgs-icon-bg)" />
      <rect
        x="4.5"
        y="4.5"
        width="55"
        height="55"
        rx="13.5"
        stroke="url(#epgs-icon-ring)"
        strokeWidth="1.5"
      />

      <rect x="17" y="18" width="30" height="28" rx="5" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1" />
      <circle cx="24" cy="27" r="4.5" fill="#151515" stroke="url(#epgs-icon-accent)" strokeWidth="1.2" />
      <path d="M30 27h14" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
      <path d="M30 33h11" stroke="#333" strokeWidth="2" strokeLinecap="round" />
      <path d="M30 39h8" stroke="#2d2d2d" strokeWidth="2" strokeLinecap="round" />

      <path
        d="M14 42 L24 30 L34 38 L50 20"
        stroke="url(#epgs-icon-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#epgs-icon-glow)"
      />
      <circle cx="50" cy="20" r="2.4" fill="#39ff14" />
    </svg>
  );
}

interface EpgsLogoProps {
  showSlogan?: boolean;
  showVersion?: boolean;
  version?: string;
  compact?: boolean;
  className?: string;
}

export function EpgsLogo({
  showSlogan = true,
  showVersion = true,
  version = APP_VERSION,
  compact = false,
  className,
}: EpgsLogoProps) {
  return (
    <div className={["epgs-logo", compact ? "epgs-logo-compact" : "", className].filter(Boolean).join(" ")}>
      <div className="epgs-logo-top">
        <h1 className="epgs-logo-wordmark" aria-label="EPGS">
          <span className="epgs-logo-letter epgs-logo-letter-e">E</span>
          <span className="epgs-logo-letter epgs-logo-letter-p">P</span>
          <span className="epgs-logo-letter epgs-logo-letter-g">G</span>
          <span className="epgs-logo-letter epgs-logo-letter-s">S</span>
        </h1>
        {showVersion ? <span className="epgs-logo-version">{version}</span> : null}
      </div>
      {showSlogan ? (
        <p className="epgs-logo-slogan">Easy Profile Generator Software</p>
      ) : null}
    </div>
  );
}
