interface EnhanceIconProps {
  className?: string
}

/**
 * "Enhance prompt" glyph (chat bubble + code + sparkle), adapted from
 * resources/enhance.svg to use currentColor so brightness can be driven via
 * text color. Sizing is controlled by className.
 */
export function EnhanceIcon({ className }: EnhanceIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Chat bubble with removed top-right corner */}
      <path
        d="M35 30 H74 M112 78 V88 C112 98 105 105 95 105 H72 L60 118 L48 105 H35 C25 105 18 98 18 88 V47 C18 37 25 30 35 30"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Code symbol */}
      <path
        d="M48 55L34 69L48 83"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Text lines */}
      <line x1="65" y1="52" x2="74" y2="52" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <line x1="65" y1="68" x2="95" y2="68" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <line x1="65" y1="84" x2="81" y2="84" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      {/* Sparkle */}
      <path
        d="M112 16 L117 28 L129 33 L117 38 L112 50 L107 38 L95 33 L107 28 Z"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
