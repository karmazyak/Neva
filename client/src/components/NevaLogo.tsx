interface NevaLogoProps {
  size?: number
  className?: string
  animated?: boolean
}

export default function NevaLogo({ size = 40, className = '', animated = false }: NevaLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="neva-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2CC4C4" />
          <stop offset="100%" stopColor="#0A84FF" />
        </linearGradient>
        {animated && (
          <style>{`
            @keyframes neva-draw {
              from { stroke-dashoffset: 200; opacity: 0; }
              to { stroke-dashoffset: 0; opacity: 1; }
            }
            .neva-path {
              stroke-dasharray: 200;
              animation: neva-draw 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }
          `}</style>
        )}
      </defs>

      {/* Chat bubble background */}
      <path
        d="M14 18C14 13.582 17.582 10 22 10H78C82.418 10 86 13.582 86 18V62C86 66.418 82.418 70 78 70H58L50 82L42 70H22C17.582 70 14 66.418 14 62V18Z"
        fill="url(#neva-gradient)"
        opacity="0.15"
      />
      <path
        d="M14 18C14 13.582 17.582 10 22 10H78C82.418 10 86 13.582 86 18V62C86 66.418 82.418 70 78 70H58L50 82L42 70H22C17.582 70 14 66.418 14 62V18Z"
        stroke="url(#neva-gradient)"
        strokeWidth="2.5"
        fill="none"
      />

      {/* Letter N — two vertical bars + diagonal wave */}
      <path
        d="M28 58V22M28 22L52 55M52 22V58"
        stroke="url(#neva-gradient)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animated ? 'neva-path' : ''}
      />

      {/* Subtle wave dot — accent */}
      <circle cx="72" cy="55" r="5" fill="url(#neva-gradient)" opacity="0.7" />
    </svg>
  )
}
