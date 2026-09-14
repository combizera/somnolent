import { useEffect, useRef } from 'react'

interface Props {
  /** Rótulo pra leitor de tela, ex.: "Largura da sidebar". */
  label: string
  /** Recebe o clientX do ponteiro; quem passa converte em largura. */
  onDrag: (clientX: number) => void
  /** Teclado: passo em px, sinalizado (← negativo, → positivo). */
  onStep: (deltaPx: number) => void
  /** Duplo clique volta ao default. */
  onReset: () => void
  /** Posição no grid de quem usa — o divisor não sabe onde ele mora. */
  style?: React.CSSProperties
}

/** Passo do teclado; com Shift anda mais rápido. */
const STEP = 16
const STEP_FAST = 64

/**
 * Divisor arrastável entre dois painéis. É um grid item de 5px, então não
 * precisa de posicionamento absoluto nem de cálculo de offset — a área de
 * clique é a coluna inteira, e o traço visível é o ::after de 1px.
 */
export function ResizeHandle({ label, onDrag, onStep, onReset, style }: Props) {
  const dragging = useRef(false)

  // Desmontar no meio do arraste (trocar de request, por exemplo) nunca dispara
  // o pointerup — e sem esta limpeza a classe fica no body e o app inteiro
  // continua com o cursor de redimensionar.
  useEffect(
    () => () => {
      document.body.classList.remove('is-resizing')
    },
    [],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      style={style}
      onPointerDown={(e) => {
        // Só botão principal: com o direito o menu de contexto rouba o pointerup.
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('is-resizing')
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        onDrag(e.clientX)
      }}
      onPointerUp={(e) => {
        // Sem o guard, um pointerup sem captura correspondente joga exceção.
        if (!dragging.current) return
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('is-resizing')
      }}
      onPointerCancel={() => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const fast = e.shiftKey ? STEP_FAST : STEP
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onStep(-fast)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onStep(fast)
        } else if (e.key === 'Home') {
          e.preventDefault()
          onReset()
        }
      }}
      title={`${label} — arraste, duplo clique para o padrão`}
      className="group relative cursor-col-resize touch-none select-none bg-transparent
                 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2
                 after:bg-line after:transition-colors
                 hover:after:bg-brand focus-visible:after:bg-brand
                 focus-visible:outline-none"
    />
  )
}
