import type { HttpMethod } from '@somnolent/core'
import { METHOD_CHIP, METHOD_SHORT } from '../lib/methodColors'

export function MethodChip({ method }: { method: HttpMethod }) {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center justify-center rounded px-1.5 font-mono text-[10px] font-bold tracking-wide ${METHOD_CHIP[method]}`}
    >
      {METHOD_SHORT[method] ?? method}
    </span>
  )
}
