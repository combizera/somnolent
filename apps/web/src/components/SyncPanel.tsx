import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { onSyncStatus, syncNow, type SyncStatus } from '../lib/sync'
import { useStore } from '../store'

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

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  )
}

function AuthForm() {
  const setAuth = useStore((s) => s.setAuth)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const fn = mode === 'login' ? api.login : api.register
      const res = await fn(email, password)
      setAuth(res.token, res.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">
        {mode === 'login' ? 'Entrar' : 'Criar conta'}
      </h2>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="voce@empresa.com"
        className={inputClass}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="senha (8+ caracteres)"
        className={inputClass}
      />
      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !email || !password}
        className="w-full rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
      >
        {busy ? '…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
      </button>
      <button
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="w-full text-xs text-ink-faint transition hover:text-ink"
      >
        {mode === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
      </button>
    </div>
  )
}

function WorkspacePicker() {
  const token = useStore((s) => s.auth.token)!
  const setServerWorkspace = useStore((s) => s.setServerWorkspace)
  const replaceAllData = useStore((s) => s.replaceAllData)
  const [existing, setExisting] = useState<{ id: string; name: string; role: string }[]>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listWorkspaces(token)
      .then((r) => setExisting(r.workspaces))
      .catch(() => {})
  }, [token])

  const create = async () => {
    try {
      const ws = await api.createWorkspace(token, name.trim())
      // Workspace novo: o conteúdo local atual sobe no primeiro sync.
      setServerWorkspace(ws.id, ws.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar workspace.')
    }
  }

  const join = async () => {
    try {
      const ws = await api.acceptInvite(token, code.trim())
      // Entrando no workspace de outra pessoa: o servidor é a fonte da verdade.
      replaceAllData()
      setServerWorkspace(ws.id, ws.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Convite inválido.')
    }
  }

  const reconnect = (ws: { id: string; name: string }) => {
    replaceAllData()
    setServerWorkspace(ws.id, ws.name)
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-ink">Workspace compartilhado</h2>

      {existing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-faint">Seus workspaces no servidor:</p>
          {existing.map((ws) => (
            <button
              key={ws.id}
              onClick={() => reconnect(ws)}
              className="flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-sm text-ink transition hover:bg-raised"
            >
              <span>{ws.name}</span>
              <span className="text-xs text-ink-faint">{ws.role}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-faint">
          Criar um novo (seu conteúdo local vira o conteúdo dele):
        </p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nome do workspace"
            className={inputClass}
          />
          <button
            onClick={create}
            disabled={!name.trim()}
            className="shrink-0 rounded-md bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
          >
            Criar
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-faint">Ou entrar com um código de convite:</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="código"
            className={`${inputClass} font-mono`}
          />
          <button
            onClick={join}
            disabled={!code.trim()}
            className="shrink-0 rounded-md border border-line px-3 text-sm text-ink transition hover:bg-raised disabled:opacity-40"
          >
            Entrar
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

function ConnectedPanel() {
  const token = useStore((s) => s.auth.token)!
  const email = useStore((s) => s.auth.email)
  const server = useStore((s) => s.server)
  const lastSyncAt = useStore((s) => s.lastSyncAt)
  const disconnectWorkspace = useStore((s) => s.disconnectWorkspace)
  const clearAuth = useStore((s) => s.clearAuth)
  const [invite, setInvite] = useState('')
  const [inviteError, setInviteError] = useState('')
  const status = useSyncStatus()

  const generateInvite = async () => {
    try {
      const { code } = await api.createInvite(token, server.workspaceId!)
      setInvite(code)
      setInviteError('')
      await navigator.clipboard?.writeText(code).catch(() => {})
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Falha ao gerar convite.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{server.name}</h2>
        <p className="text-xs text-ink-faint">{email}</p>
      </div>

      <div className="rounded-md border border-line bg-app p-3 text-xs text-ink-dim">
        <p className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
          {status === 'ok' && 'Sincronizado'}
          {status === 'syncing' && 'Sincronizando…'}
          {status === 'error' && 'Erro no sync — tentando de novo'}
          {status === 'off' && 'Desconectado'}
        </p>
        {lastSyncAt && (
          <p className="mt-1 text-ink-faint">
            Último sync: {new Date(lastSyncAt).toLocaleTimeString()}
          </p>
        )}
        <button
          onClick={() => void syncNow()}
          className="mt-2 rounded-md border border-line px-2 py-1 text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          Sincronizar agora
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={generateInvite}
          className="w-full rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
        >
          Gerar código de convite
        </button>
        {invite && (
          <p className="rounded-md bg-app p-2 text-center font-mono text-sm text-ok">
            {invite} <span className="text-xs text-ink-faint">(copiado)</span>
          </p>
        )}
        {inviteError && <p className="text-xs text-bad">{inviteError}</p>}
      </div>

      <div className="flex gap-2 text-xs">
        <button
          onClick={disconnectWorkspace}
          className="flex-1 rounded-md border border-line px-2 py-1.5 text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          Trocar workspace
        </button>
        <button
          onClick={clearAuth}
          className="flex-1 rounded-md border border-line px-2 py-1.5 text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          Sair da conta
        </button>
      </div>
    </div>
  )
}

export function SyncPanel() {
  const [open, setOpen] = useState(false)
  const token = useStore((s) => s.auth.token)
  const workspaceId = useStore((s) => s.server.workspaceId)
  const serverName = useStore((s) => s.server.name)
  const status = useSyncStatus()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Colaboração e sync"
      >
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        {workspaceId ? serverName : 'Sync'}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          {!token ? <AuthForm /> : !workspaceId ? <WorkspacePicker /> : <ConnectedPanel />}
        </Modal>
      )}
    </>
  )
}
