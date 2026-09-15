import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ApiRequest } from '@somnolent/core'
import { MethodChip } from './MethodChip'
import { useStore, useVisibleTabs } from '../store'

/**
 * Onde o menu de contexto abriu, em coordenadas de viewport.
 * `requestId` é a aba clicada — `null` quando o clique caiu no vazio da barra,
 * onde só "Fechar todas" faz sentido.
 */
interface MenuAt {
  x: number
  y: number
  requestId: string | null
}

/** Largura do menu. Precisa bater com a classe `w-52` para o clamp funcionar. */
const MENU_WIDTH = 208

function MenuItem({
  label,
  onSelect,
  danger = false,
}: {
  label: string
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className={`w-full px-3 py-1.5 text-left text-sm transition hover:bg-raised ${
        danger ? 'text-ink-dim hover:text-bad' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const closeTab = useStore((s) => s.closeTab)
  const closeOtherTabs = useStore((s) => s.closeOtherTabs)
  const closeAllTabs = useStore((s) => s.closeAllTabs)
  const tabs = useVisibleTabs()

  // Fecha em qualquer coisa que não seja escolher um item: clique fora, Esc,
  // rolagem, ou a janela perdendo o foco. Sem isto o menu fica pendurado.
  useEffect(() => {
    const dismiss = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // `capture` no pointerdown: o menu precisa sumir antes de o clique chegar
    // a quem está embaixo.
    window.addEventListener('pointerdown', dismiss, { capture: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', dismiss, { capture: true })
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, { capture: true })
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  // A barra vive no topo da janela, então sobra altura pra baixo e só o x
  // precisa de trava — perto da borda direita o menu abriria fora da tela.
  const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - 8)
  // Só entra no bloco quando existe; o `!` some daqui em troca de uma const.
  const target = at.requestId ?? ''

  return (
    <div
      role="menu"
      // O menu não é filho da barra: `stopPropagation` no pointerdown impede
      // que o listener de "clique fora" mate o menu antes do clique no item.
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, top: at.y }}
      className="fixed z-50 w-52 overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg"
    >
      {at.requestId && (
        <>
          <MenuItem label="Fechar" onSelect={run(() => closeTab(target))} />
          {/* Uma aba sozinha não tem "outras": o item sai em vez de virar
              um clique que não faz nada. */}
          {tabs.length > 1 && (
            <MenuItem label="Fechar as outras" onSelect={run(() => closeOtherTabs(target))} />
          )}
        </>
      )}
      <MenuItem label="Fechar todas" onSelect={run(closeAllTabs)} danger />
    </div>
  )
}

function Tab({
  request,
  active,
  onContextMenu,
}: {
  request: ApiRequest
  active: boolean
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const openTab = useStore((s) => s.openTab)
  const closeTab = useStore((s) => s.closeTab)
  const mine = useRef<HTMLDivElement>(null)

  // Aba que virou ativa por fora da barra (Ctrl+K, clique na sidebar) pode
  // estar fora da área rolável. Sem isto ela fica ativa e invisível.
  // O `?.` no método não é decoração: jsdom não implementa scrollIntoView, e
  // sem ele o efeito derruba a árvore inteira em teste.
  useEffect(() => {
    if (active) mine.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div
      ref={mine}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => openTab(request.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openTab(request.id)
        }
      }}
      onAuxClick={(e) => {
        // Botão do meio fecha, como em qualquer barra de abas.
        if (e.button === 1) {
          e.preventDefault()
          closeTab(request.id)
        }
      }}
      onContextMenu={onContextMenu}
      title={request.name}
      className={`group relative flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3 text-sm transition ${
        // A ativa usa o fundo do painel de baixo, pra ler como uma coisa só; as
        // outras ficam no fundo recuado da barra.
        active ? 'bg-panel text-ink' : 'text-ink-dim hover:bg-raised hover:text-ink'
      }`}
    >
      {/* O traço em cima marca a ativa; a cor é a do environment, que já pinta
          a faixa do topo do app. */}
      {active && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />
      )}
      <MethodChip method={request.method} />
      <span className="min-w-0 flex-1 truncate">{request.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          closeTab(request.id)
        }}
        className={`-mr-1 shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-hover hover:text-ink ${
          active ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="Fechar aba"
        aria-label={`Fechar ${request.name}`}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * Barra das requests abertas, acima dos painéis.
 *
 * Mostra só as abas da collection em contexto — duas APIs abertas não
 * disputam a mesma largura — e não renderiza nada quando não há aba, pra não
 * cobrar uma faixa de 36px de quem está na lista de collections. Por isso quem
 * usa posiciona os painéis por conta própria: sem a barra, a linha dela some.
 */
export function TabStrip({ style }: { style?: React.CSSProperties }) {
  const tabs = useVisibleTabs()
  const selectedId = useStore((s) => s.selectedRequestId)
  const [menu, setMenu] = useState<MenuAt | null>(null)

  // Fechou a última aba: o menu que estava aberto sobre ela perde o assunto.
  useEffect(() => {
    if (tabs.length === 0) setMenu(null)
  }, [tabs.length])

  if (tabs.length === 0) return null

  const openMenu = (requestId: string | null) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, requestId })
  }

  return (
    <div
      role="tablist"
      aria-label="Requests abertas"
      onContextMenu={openMenu(null)}
      style={style}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-app
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((request) => (
        <Tab
          key={request.id}
          request={request}
          active={request.id === selectedId}
          onContextMenu={openMenu(request.id)}
        />
      ))}
      {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
