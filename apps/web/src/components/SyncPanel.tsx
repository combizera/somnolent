import { useEffect, useState } from 'react'
import { Eye, KeyRound, Link2, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, type KeyRow } from '../lib/api'
import { onSyncStatus, syncNow, type SyncStatus } from '../lib/sync'
import { useStore } from '../store'
import { useSession } from '../sessionStore'
import { useConfirm } from '../lib/confirm'
import { Modal } from './Modal'
import { fieldLabel as label, inputClass } from '../lib/ui'

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

/** O botão perdeu o texto, então o estado precisa estar no title. */
const STATUS_TITLE: Record<SyncStatus, string> = {
  off: 'Sync desligado — clique para conectar',
  syncing: 'Sincronizando…',
  ok: 'Sync em dia — clique para ver e compartilhar',
  error: 'Sync com erro — clique para ver',
}

const STATUS_DOT: Record<SyncStatus, string> = {
  off: 'bg-ink-faint',
  syncing: 'bg-info animate-pulse',
  ok: 'bg-ok',
  error: 'bg-bad',
}

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

/** Sem conexão: criar um project novo ou entrar com uma chave existente. */
function Connect() {
  const connect = useStore((s) => s.connect)
  const adoptRemoteProject = useStore((s) => s.adoptRemoteProject)
  const enterRemoteProject = useStore((s) => s.enterRemoteProject)
  const [name, setName] = useState('')
  const [key, setKey] = useState(takeKeyFromUrl)
  const [createToken, setCreateToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)


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
          placeholder="Cole o link ou a chave somn_…"
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
              // Entrar num project de outra pessoa: ele nasce local com o id do
              // servidor e o primeiro pull traz o conteúdo. Os outros projects
              // desta máquina não são tocados.
              enterRemoteProject(info.project)
              connect(raw, {
                scope: info.scope,
                role: info.role,
                label: info.label,
                projectId: info.project.id,
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
          placeholder="Nome do project"
          className={inputClass}
        />
        <input
          value={createToken}
          onChange={(e) => setCreateToken(e.target.value)}
          placeholder="Segredo do servidor (só se ele exigir)"
          className={`${inputClass} text-sm`}
        />
        <button
          disabled={!name.trim() || busy}
          onClick={() =>
            void run(async () => {
              const res = await api.createProject(name.trim(), createToken.trim() || undefined)
              // Conecta na hora: a chave fica guardada nesta máquina e é ela
              // que emite as dos outros. Mostrar a chave e esperar que a pessoa
              // a salvasse deixava o project órfão se ela fechasse o modal.
              adoptRemoteProject({ id: res.id, name: res.name })
              connect(res.key, {
                scope: 'project',
                role: 'write',
                label: 'Esta máquina',
                projectId: res.id,
                projectName: res.name,
                collectionId: null,
              })
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
  const openShare = useSession((s) => s.openShare)
  const status = useSyncStatus()
  const confirm = useConfirm()

  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const key = connection.key!
  const readOnly = connection.role === 'read'

  const load = () => {
    api
      .listKeys(key)
      .then((r) => setKeys(r.keys))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao listar chaves.'))
  }
  useEffect(load, [key])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
            <span className="truncate">{connection.projectName}</span>
          </h2>
          <p className="text-sm text-ink-faint">
            {connection.scope === 'collection' ? 'Collection' : 'Project'} ·{' '}
            {readOnly ? 'Leitura' : 'Leitura e Escrita'} · esta chave é{' '}
            <span className="text-ink-dim">{connection.label}</span>
          </p>
          <p className="text-sm text-ink-faint">
            {lastSyncAt
              ? `Último sync ${new Date(lastSyncAt).toLocaleTimeString('pt-BR')}`
              : 'Ainda não sincronizou'}
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
        <button
          onClick={() => openShare()}
          className="flex w-fit items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
        >
          <Link2 className="size-3.5" />
          Compartilhar
        </button>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className={label}>Chaves ativas</p>
        {keys === null && <p className="text-sm text-ink-faint">Carregando…</p>}
        {keys?.length === 0 && <p className="text-sm text-ink-faint">Nenhuma chave ainda.</p>}
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
                  Esta máquina
                </span>
              )}
              <span className="shrink-0 text-[10px] text-ink-faint">
                {k.scope === 'collection' ? 'Collection' : 'Project'} ·{' '}
                {k.role === 'read' ? 'Leitura' : 'Escrita'}
              </span>
              <span className="shrink-0 text-[10px] text-ink-faint">
                {k.lastUsedAt
                  ? `Usada ${new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}`
                  : 'Nunca usada'}
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
      {/* Só o estado: o nome do project já está no ProjectSelector ao lado, e
          repetir os dois é o que fazia o header parecer cheio. */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-2 text-ink-dim transition hover:bg-raised hover:text-ink"
        title={STATUS_TITLE[status]}
        aria-label={STATUS_TITLE[status]}
      >
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        {connection.role === 'read' && <Eye aria-hidden className="size-3 text-ink-faint" />}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>{connection.key ? <Connected /> : <Connect />}</Modal>
      )}
    </>
  )
}
