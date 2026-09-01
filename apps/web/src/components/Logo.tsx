import { useId } from 'react'

/**
 * Marca do Somnolent — crescent com gradiente lilás→índigo e estrela branca
 * (variação "A · Gradiente" de logo-preview.html).
 *
 * É SVG escrito à mão de propósito: logo é marca, não ícone de UI — os ícones
 * da interface vêm todos do lucide-react.
 */
export function Logo({ className }: { className?: string }) {
  // os ids de gradient/mask precisam ser únicos por instância no documento
  const uid = useId()
  const gradient = `logo-crescent-${uid}`
  const mask = `logo-bite-${uid}`

  return (
    <svg
      viewBox="0 0 56 56"
      fill="none"
      role="img"
      aria-label="Somnolent"
      className={className}
    >
      <defs>
        <linearGradient id={gradient} x1="6" y1="8" x2="46" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c4b0ff" />
          <stop offset="100%" stopColor="#5b3fd4" />
        </linearGradient>
        <mask id={mask}>
          <rect width="56" height="56" fill="white" />
          <circle cx="36" cy="22" r="19.5" fill="black" />
        </mask>
      </defs>
      <circle cx="27" cy="29" r="21" fill={`url(#${gradient})`} mask={`url(#${mask})`} />
      <path
        d="M42 11 L43.4 14.6 L47 16 L43.4 17.4 L42 21 L40.6 17.4 L37 16 L40.6 14.6 Z"
        fill="#ffffff"
        opacity="0.9"
      />
    </svg>
  )
}
