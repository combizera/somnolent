import { useEffect, useState } from 'react'
import { Check, Copy, Eye, KeyRound, Link2, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, type KeyRow } from '../lib/api'
import { onSyncStatus, syncNow, type SyncStatus } from '../lib/sync'
import { useStore } from '../store'
import { useConfirm } from '../lib/confirm'

function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>('off')
  useEffect(() => {
    const unsubscribe = onSyncStatus(setStatus)
    return () => {
      unsubscribe()
    }
  }, [])
  return status
}

const STATUS_DOT: Record<SyncStatus, string> = {
  off: 'bg-ink-faint',
  syncing: 'bg-info animate-pulse',
  ok: 'bg-ok',
  error: 'bg-bad',
}

const inputClass =
  'w-full rounded-md border border-line bg-app px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none'

const label = 'text-[10px] font-semibold tracking-wider text-ink-faint uppercase'

/** A chave viaja no fragmento: fragmento não chega ao servidor nem a log de acesso. */
const linkFor = (key: string) => `${window.location.origin}/#k=${key}`

/**
 * Chave que veio no link que abriu o app. Some da barra de endereço assim que
 * é lida — chave em histórico de navegador é chave vazada.
 */
function takeKeyFromUrl(): string {
  const match = window.location.hash.match(/^#k=(somn_[\w-]+)/)
  if (!match) return ''
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return match[1]!
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  )
}

/** Campo somente-leitura com botão de copiar — usado pra chave e pro link. */
function CopyField({ value, hint }: { value: string; hint: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} font-mono text-sm`}
        />
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'copiado' : 'copiar'}
        </button>
      </div>
      <p className="text-sm text-ink-faint">{hint}</p>
    </div>
  )
}

/** Sem conexão: criar um project novo ou entrar com uma chave existente. */
function Connect() {
  const connect = useStore((s) => s.connect)
  const replaceAllData = useStore((s) => s.replaceAllData)
  const [name, setName] = useState('')
  const [key, setKey] = useState(takeKeyFromUrl)
  const [createToken, setCreateToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)

  const apply = async (raw: string) => {
    const info = await api.me(raw)
    connect(raw, {
      scope: info.scope,
      role: info.role,
      label: info.label,
      projectName: info.project.name,
      collectionId: info.collection?.id ?? null,
    })
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não consegui falar com o servidor.')
    } finally {
      setBusy(false)
    }
  }

  if (fresh) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Project criado</h2>
          <p className="text-sm leading-relaxed text-ink-faint">
            Guarde esta chave agora: ela não aparece de novo. O servidor só armazena um hash dela.
          </p>
        </div>
        <CopyField value={fresh} hint="Chave de escrita desta máquina." />
        <CopyField value={linkFor(fresh)} hint="Link pra colar em outra máquina sua." />
        <button
          onClick={() => void run(async () => { await apply(fresh); setFresh(null) })}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
        >
          Conectar com esta chave
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Sync</h2>
        <p className="text-sm leading-relaxed text-ink-faint">
          Sem conta e sem senha: a chave é a credencial. Variáveis secretas continuam só nesta
          máquina — nem o servidor nem quem receber o link enxerga o valor delas.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className={label}>Entrar com uma chave</p>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="cole o link ou a chave somn_…"
          spellCheck={false}
          className={`${inputClass} font-mono text-sm`}
        />
        <button
          disabled={!key.trim() || busy}
          onClick={() =>
            void run(async () => {
              const raw = key.trim().split('#k=').pop()!.trim()
              // Valida a chave ANTES de tocar em qualquer coisa: apagar primeiro
              // significaria perder o workspace por causa de uma chave com typo.
              const info = await api.me(raw)
              // Entrar num project de outra pessoa substitui o conteúdo local:
              // o primeiro pull traz tudo de lá.
              replaceAllData()
              connect(raw, {
                scope: info.scope,
                role: info.role,
                label: info.label,
                projectName: info.project.name,
                collectionId: info.collection?.id ?? null,
              })
            })
          }
          className="w-fit rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
        >
          Conectar
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className={label}>Ou criar um project novo</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="nome do project"
          className={inputClass}
        />
        <input
          value={createToken}
          onChange={(e) => setCreateToken(e.target.value)}
          placeholder="segredo do servidor (só se ele exigir)"
          className={`${inputClass} text-sm`}
        />
        <button
          disabled={!name.trim() || busy}
          onClick={() =>
            void run(async () => {
              const res = await api.createProject(name.trim(), createToken.trim() || undefined)
              setFresh(res.key)
            })
          }
          className="flex w-fit items-center gap-1.5 rounded-md border border-line px-4 py-2 text-sm text-ink-dim transition hover:bg-raised hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Criar project
        </button>
      </div>

      {error && <p className="text-sm leading-relaxed text-bad">{error}</p>}
    </div>
  )
}

/** Conectado: estado, chaves emitidas e o botão de compartilhar. */
function Connected() {
  const connection = useStore((s) => s.connection)
  const disconnect = useStore((s) => s.disconnect)
  const lastSyncAt = useStore((s) => s.lastSyncAt)
  const collections = useStore((s) => s.collections)
  const openProjectId = useStore((s) => s.openProjectId)
  const status = useSyncStatus()
  const confirm = useConfirm()

  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<'write' | 'read'>('read')
  const [newScope, setNewScope] = useState<string>('')
  const [issued, setIssued] = useState<string | null>(null)

  const key = connection.key!
  const readOnly = connection.role === 'read'

  const load = () => {
    api
      .listKeys(key)
      .then((r) => setKeys(r.keys))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao listar chaves.'))
  }
  useEffect(load, [key])

  const shareable = collections.filter((c) => c.parentId === null && c.projectId === openProjectId)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
            <span className="truncate">{connection.projectName}</span>
          </h2>
          <p className="text-sm text-ink-faint">
            {connection.scope === 'collection' ? 'uma collection' : 'project inteiro'} ·{' '}
            {readOnly ? 'somente leitura' : 'leitura e escrita'} · esta chave é{' '}
            <span className="text-ink-dim">{connection.label}</span>
          </p>
          <p className="text-sm text-ink-faint">
            {lastSyncAt
              ? `último sync ${new Date(lastSyncAt).toLocaleTimeString('pt-BR')}`
              : 'ainda não sincronizou'}
          </p>
        </div>
        <button
          onClick={() => void syncNow()}
          className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          Sincronizar agora
        </button>
      </div>

      {readOnly && (
        <p className="rounded-md border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm leading-relaxed text-ink-dim">
          Esta chave só lê. Suas edições ficam nesta máquina e não sobem — peça uma chave de
          escrita a quem compartilhou.
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className={label}>Compartilhar</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="quem vai usar — ex.: Mac do Ygor"
              className={`${inputClass} min-w-40 flex-1`}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'write' | 'read')}
              className="rounded-md border border-line bg-app px-2 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="read">só leitura</option>
              <option value="write">leitura e escrita</option>
            </select>
            {connection.scope === 'project' && (
              <select
                value={newScope}
                onChange={(e) => setNewScope(e.target.value)}
                className="rounded-md border border-line bg-app px-2 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">project inteiro</option>
                {shareable.map((c) => (
                  <option key={c.id} value={c.id}>
                    só {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={!newLabel.trim()}
              onClick={() => {
                setError(null)
                api
                  .createKey(key, {
                    label: newLabel.trim(),
                    role: newRole,
                    // chave de collection só emite chave da própria collection —
                    // mandar null aqui fazia o servidor recusar com 403
                    collectionId:
                      connection.scope === 'collection'
                        ? connection.collectionId
                        : newScope || null,
                  })
                  .then((r) => {
                    setIssued(r.key)
                    setNewLabel('')
                    load()
                  })
                  .catch((err) =>
                    setError(err instanceof ApiError ? err.message : 'Falha ao emitir chave.'),
                  )
              }}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
            >
              <Link2 className="size-3.5" />
              Gerar link
            </button>
          </div>
          {issued && (
            <div className="flex flex-col gap-2 rounded-md border border-line bg-app p-3">
              <CopyField
                value={linkFor(issued)}
                hint="Mande este link. Ele aparece só agora — depois, só emitindo outro."
              />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className={label}>Chaves ativas</p>
        {keys === null && <p className="text-sm text-ink-faint">carregando…</p>}
        {keys?.length === 0 && <p className="text-sm text-ink-faint">nenhuma chave.</p>}
        <div className="flex flex-col gap-1">
          {keys?.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 rounded-md border border-line-soft bg-app px-2.5 py-1.5 text-sm"
            >
              <KeyRound aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-ink">{k.label}</span>
              {k.mine && (
                <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand-hi">
                  esta máquina
                </span>
              )}
              <span className="shrink-0 text-[10px] text-ink-faint">
                {k.scope === 'collection' ? 'collection' : 'project'} ·{' '}
                {k.role === 'read' ? 'leitura' : 'escrita'}
              </span>
              <span className="shrink-0 text-[10px] text-ink-faint">
                {k.lastUsedAt
                  ? `usada ${new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}`
                  : 'nunca usada'}
              </span>
              {!readOnly && !k.mine && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Revogar a chave "${k.label}"?`,
                      message: 'Quem estiver usando ela perde o acesso na hora, sem aviso.',
                      confirmLabel: 'Revogar',
                      danger: true,
                    })
                    if (!ok) return
                    api
                      .revokeKey(key, k.id)
                      .then(load)
                      .catch((err) =>
                        setError(err instanceof ApiError ? err.message : 'Falha ao revogar.'),
                      )
                  }}
                  className="shrink-0 text-ink-faint transition hover:text-bad"
                  title="Revogar chave"
                  aria-label="Revogar chave"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      <button
        onClick={disconnect}
        className="w-fit border-t border-line pt-4 text-sm text-ink-faint transition hover:text-bad"
      >
        Desconectar esta máquina
      </button>
    </div>
  )
}

export function SyncPanel() {
  const connection = useStore((s) => s.connection)
  // Abriu pelo link compartilhado? Já mostra o painel com a chave preenchida.
  const [open, setOpen] = useState(
    () => !connection.key && window.location.hash.startsWith('#k='),
  )
  const status = useSyncStatus()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Sync e compartilhamento"
      >
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        {connection.key ? connection.projectName : 'Sync'}
        {connection.role === 'read' && (
          <Eye aria-hidden className="size-3 text-ink-faint" />
        )}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>{connection.key ? <Connected /> : <Connect />}</Modal>
      )}
    </>
  )
}
