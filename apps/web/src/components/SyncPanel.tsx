import { useEffect, useState } from 'react'
import { Boxes, Eye, FolderClosed, KeyRound, Link2, PenLine, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, type KeyRow } from '../lib/api'
import { onSyncStatus, syncNow, type SyncStatus } from '../lib/sync'
import { useStore } from '../store'
import { useSession } from '../sessionStore'
import { useConfirm } from '../lib/confirm'
import { Modal } from './Modal'
import { fieldLabel as label, headerButton, inputClass } from '../lib/ui'

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

/** The button lost its text, so the state has to live in the title. */
const STATUS_TITLE: Record<SyncStatus, string> = {
  off: 'Sync off — click to connect',
  syncing: 'Syncing…',
  ok: 'Sync up to date — click to view and share',
  error: 'Sync failing — click to view',
}

const STATUS_DOT: Record<SyncStatus, string> = {
  off: 'bg-ink-faint',
  syncing: 'bg-info animate-pulse',
  ok: 'bg-ok',
  error: 'bg-bad',
}

/** Key that came in the link which opened the app. It leaves the address bar as
 *  soon as it is read — a key in browser history is a leaked key. */
function takeKeyFromUrl(): string {
  const match = window.location.hash.match(/^#k=(somn_[\w-]+)/)
  if (!match) return ''
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return match[1]!
}

/** No connection: create a new project or join with an existing key. */
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
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Sync</h2>
        <p className="text-sm leading-relaxed text-ink-faint">
          No account and no password: the key is the credential. Secret variables stay on this
          machine — neither the server nor whoever gets the link sees their values.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className={label}>Join with a key</p>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste the link or the somn_… key"
          spellCheck={false}
          className={`${inputClass} font-mono text-sm`}
        />
        <button
          disabled={!key.trim() || busy}
          onClick={() =>
            void run(async () => {
              const raw = key.trim().split('#k=').pop()!.trim()
              // Validate the key BEFORE touching anything: clearing first would
              // cost the whole workspace over a typo.
              const info = await api.me(raw)
              // Joining someone else's project: it starts local with the server
              // id, and the first pull brings the content.
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
          Connect
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className={label}>Or create a new project</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className={inputClass}
        />
        <input
          value={createToken}
          onChange={(e) => setCreateToken(e.target.value)}
          placeholder="Server secret (only if it requires one)"
          className={`${inputClass} text-sm`}
        />
        <button
          disabled={!name.trim() || busy}
          onClick={() =>
            void run(async () => {
              const res = await api.createProject(name.trim(), createToken.trim() || undefined)
              // Connect right away: the key is stored here and issues the others.
              // Showing it and hoping it got saved orphaned the project.
              adoptRemoteProject({ id: res.id, name: res.name })
              connect(res.key, {
                scope: 'project',
                role: 'write',
                label: 'This machine',
                projectId: res.id,
                projectName: res.name,
                collectionId: null,
              })
            })
          }
          className="flex w-fit items-center gap-1.5 rounded-md border border-line px-4 py-2 text-sm text-ink-dim transition hover:bg-raised hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Create project
        </button>
      </div>

      {error && <p className="text-sm leading-relaxed text-bad">{error}</p>}
    </div>
  )
}

/** "13:35:02" does not say whether it was now or yesterday. This does, in a sentence. */
function lastSyncLabel(iso: string | null): string {
  if (!iso) return 'Not synced yet'
  const date = new Date(iso)
  const ms = Date.now() - date.getTime()
  if (ms < 60_000) return 'Synced just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `Synced ${min} min ago`
  const hora = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === new Date().toDateString()
    ? `Synced today at ${hora}`
    : `Synced on ${date.toLocaleDateString('pt-BR')}, ${hora}`
}

/** One connection fact: icon + text, no label — the icon is the label. `fixo`
 *  protects the known-text facts; only the key label gives up room. */
function Fact({
  icon,
  fixo = false,
  children,
}: {
  icon: React.ReactNode
  fixo?: boolean
  children: React.ReactNode
}) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${fixo ? 'shrink-0' : ''}`}>
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Connected: state, issued keys and the share button. */
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
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not list the keys.'))
  }
  useEffect(load, [key])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
              <span className="truncate">{connection.projectName}</span>
            </h2>

            {/* Everything below lines up with the project name: the dot is 8px
                and the gap 8px, hence pl-4. */}
            <p className="mt-1 pl-4 text-sm text-ink-faint" title={lastSyncAt ?? undefined}>
              {lastSyncLabel(lastSyncAt)}
            </p>
          </div>

          <button
            onClick={() => void syncNow()}
            className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
          >
            Sync now
          </button>
        </div>

        {/* Its own row, not the column that shares space with the button: there
            the three facts broke into two lines. */}
        <div className="flex items-center gap-4 overflow-hidden pl-4 text-sm text-ink-dim">
          <Fact
            fixo
            icon={
              connection.scope === 'collection' ? (
                <FolderClosed aria-hidden className="size-3.5" />
              ) : (
                <Boxes aria-hidden className="size-3.5" />
              )
            }
          >
            {connection.scope === 'collection' ? 'One collection' : 'Whole project'}
          </Fact>

          <Fact
            fixo
            icon={
              readOnly ? (
                <Eye aria-hidden className="size-3.5" />
              ) : (
                <PenLine aria-hidden className="size-3.5" />
              )
            }
          >
            {readOnly ? 'Read only' : 'Read and write'}
          </Fact>

          <Fact icon={<KeyRound aria-hidden className="size-3.5" />}>{connection.label}</Fact>
        </div>
      </div>

      {readOnly && (
        <p className="rounded-md border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm leading-relaxed text-ink-dim">
          This key only reads. Your edits stay on this machine and never go up — ask whoever
          shared it for a write key.
        </p>
      )}

      {!readOnly && (
        <button
          onClick={() => openShare()}
          className="flex w-fit items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
        >
          <Link2 className="size-3.5" />
          Share
        </button>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className={label}>Active keys</p>
        {keys === null && <p className="text-sm text-ink-faint">Loading…</p>}
        {keys?.length === 0 && <p className="text-sm text-ink-faint">No keys yet.</p>}
        {/* Cap + scroll: a project with many keys pushed the disconnect button
            out of the modal. */}
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {keys?.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 rounded-md border border-line-soft bg-app px-2.5 py-1.5 text-sm"
            >
              <KeyRound aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-ink">{k.label}</span>
              {k.mine && (
                <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-xs text-brand-hi">
                  This machine
                </span>
              )}
              <span className="shrink-0 text-xs text-ink-faint">
                {k.scope === 'collection' ? 'Collection' : 'Project'} ·{' '}
                {k.role === 'read' ? 'Read' : 'Write'}
              </span>
              <span
                className="shrink-0 text-xs text-ink-faint"
                title={k.lastUsedAt ? 'Last use of this key' : 'This key has never been used'}
              >
                {k.lastUsedAt ? `Used ${new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}` : '—'}
              </span>
              {!readOnly && !k.mine && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Revoke the key "${k.label}"?`,
                      message: 'Whoever is using it loses access at once, with no warning.',
                      confirmLabel: 'Revoke',
                      danger: true,
                    })
                    if (!ok) return
                    api
                      .revokeKey(key, k.id)
                      .then(load)
                      .catch((err) =>
                        setError(err instanceof ApiError ? err.message : 'Could not revoke it.'),
                      )
                  }}
                  className="shrink-0 text-ink-faint transition hover:text-bad"
                  title="Revoke key"
                  aria-label="Revoke key"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="border-t border-line pt-4">
        <button
          onClick={async () => {
            const ok = await confirm({
              title: 'Disconnect this machine?',
              message:
                'The collections stay here but stop syncing. The key is forgotten on this machine — coming back needs it again, and it is never shown twice.',
              confirmLabel: 'Disconnect',
              danger: true,
            })
            if (ok) disconnect()
          }}
          className="w-full rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink-dim transition hover:border-bad/40 hover:bg-bad/10 hover:text-bad"
        >
          Disconnect this machine
        </button>
      </div>
    </div>
  )
}

export function SyncPanel() {
  const connection = useStore((s) => s.connection)
  // Opened from a shared link? Show the panel with the key already filled in.
  const [open, setOpen] = useState(
    () => !connection.key && window.location.hash.startsWith('#k='),
  )
  const status = useSyncStatus()

  return (
    <>
      {/* State only: the project name is already in the ProjectSelector next to
          it, and repeating both is what made the header feel crowded. */}
      <button
        onClick={() => setOpen(true)}
        className={headerButton}
        title={STATUS_TITLE[status]}
        aria-label={STATUS_TITLE[status]}
      >
        <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
        {/* The label stays: a lone dot does not announce itself as a button.
            What does not come back is the project name. */}
        <span className="text-sm">Sync</span>
        {connection.role === 'read' && <Eye aria-hidden className="size-3 text-ink-faint" />}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>{connection.key ? <Connected /> : <Connect />}</Modal>
      )}
    </>
  )
}
