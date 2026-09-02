import { useState } from 'react'
import { CloudUpload, Link2, ShieldAlert } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useStore } from '../store'
import { useSession } from '../sessionStore'
import { CopyField, Field, Modal, Select } from './Modal'
import { inputClass, linkFor } from '../lib/ui'

/**
 * Compartilhar é uma ação, não um momento: dá pra chamar a qualquer hora e
 * quantas vezes quiser. A chave desta máquina fica salva localmente e é ela
 * que emite as dos outros — ninguém precisa ter guardado chave nenhuma.
 *
 * Se o project ainda só existe nesta máquina, o diálogo publica primeiro e
 * emite o link na sequência, num clique.
 */
export function ShareDialog() {
  const { open, collectionId: preset } = useSession((s) => s.share)
  const closeShare = useSession((s) => s.closeShare)
  if (!open) return null
  return (
    <Modal onClose={closeShare} layer="z-60">
      <Share preset={preset} />
    </Modal>
  )
}

function Share({ preset }: { preset: string | null }) {
  const closeShare = useSession((s) => s.closeShare)
  const connection = useStore((s) => s.connection)
  const connect = useStore((s) => s.connect)
  const adoptRemoteProject = useStore((s) => s.adoptRemoteProject)
  const projects = useStore((s) => s.projects)
  const openProjectId = useStore((s) => s.openProjectId)
  const collections = useStore((s) => s.collections)

  const project = projects.find((p) => p.id === openProjectId) ?? null
  const published = Boolean(connection.key) && connection.projectId === openProjectId
  const readOnly = connection.role === 'read'

  const [label, setLabel] = useState('')
  const [role, setRole] = useState<'write' | 'read'>('read')
  const [scope, setScope] = useState(preset ?? '')
  const [createToken, setCreateToken] = useState('')
  const [needsToken, setNeedsToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  const shareable = collections.filter(
    (c) => c.parentId === null && c.projectId === openProjectId,
  )
  const lockedCollection = collections.find((c) => c.id === connection.collectionId) ?? null

  /** Publica o project (se preciso) e emite a chave do convidado. */
  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      let key = published ? connection.key! : null
      if (!key) {
        const created = await api.createProject(project!.name, createToken.trim() || undefined)
        // Amarra antes de conectar: o project local vira o do servidor e o
        // primeiro push leva o que já existe aqui.
        adoptRemoteProject({ id: created.id, name: created.name })
        connect(created.key, {
          scope: 'project',
          role: 'write',
          label: 'Esta máquina',
          projectId: created.id,
          projectName: created.name,
          collectionId: null,
        })
        key = created.key
      }
      const issued = await api.createKey(key, {
        label: label.trim() || 'Convidado',
        role,
        // Chave de collection só emite chave da própria collection.
        collectionId:
          connection.scope === 'collection' ? connection.collectionId : scope || null,
      })
      setLink(linkFor(issued.key))
    } catch (err) {
      // 401/403 na criação = o servidor exige o segredo; revela o campo.
      if (err instanceof ApiError && [401, 403].includes(err.status) && !published) {
        setNeedsToken(true)
      }
      setError(err instanceof ApiError ? err.message : 'Não consegui falar com o servidor.')
    } finally {
      setBusy(false)
    }
  }

  if (readOnly) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldAlert aria-hidden className="size-4 text-warn" />
          Compartilhar
        </h2>
        <p className="text-sm leading-relaxed text-ink-dim">
          Sua chave é somente leitura, e chave de leitura não emite outras. Peça uma chave de
          escrita a quem compartilhou este project com você.
        </p>
      </div>
    )
  }

  if (link) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Link pronto</h2>
          <p className="text-sm leading-relaxed text-ink-faint">
            Vale até você revogar em <span className="text-ink-dim">Sync → Chaves ativas</span>.
          </p>
        </div>
        <CopyField value={link} hint="Aparece só agora — copie antes de fechar." />
        {/* Gerar outra chave na sequência é o caso raro: quem acabou de copiar
            o link quer fechar. */}
        <div className="flex items-center gap-2">
          <button
            onClick={closeShare}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
          >
            OK
          </button>
          <button
            onClick={() => {
              setLink(null)
              setLabel('')
            }}
            className="rounded-md border border-line px-3 py-2 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
          >
            Gerar outro link
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Compartilhar {project ? `"${project.name}"` : 'project'}
        </h2>
        <p className="text-sm leading-relaxed text-ink-faint">
          {published
            ? 'Cada pessoa recebe a chave dela. Você nunca passa a sua.'
            : 'Compartilhar publica ele no servidor e gera o link.'}
        </p>
      </div>

      <Field label="Nome" hint="Pra você reconhecer a chave depois.">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void share()}
          placeholder="my-laptop"
          className={inputClass}
        />
      </Field>

      {/* Duas colunas iguais: os dois controles fecham na mesma largura e na
          mesma altura do campo acima. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Permissão">
          <Select value={role} onChange={(v) => setRole(v as 'write' | 'read')}>
            <option value="read">Leitura</option>
            <option value="write">Leitura e Escrita</option>
          </Select>
        </Field>
        {connection.scope === 'collection' ? (
          // Chave de collection só emite chave da própria collection: não há
          // escolha a fazer, só o que informar.
          <Field label="Escopo">
            <span className="flex h-9 items-center truncate text-sm text-ink-dim">
              Collection — {lockedCollection?.name ?? '—'}
            </span>
          </Field>
        ) : (
          <Field label="Escopo">
            <Select value={scope} onChange={setScope}>
              <option value="">Project</option>
              {shareable.map((c) => (
                <option key={c.id} value={c.id}>
                  Collection — {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {needsToken && (
        <Field label="Segredo do servidor">
          <input
            value={createToken}
            onChange={(e) => setCreateToken(e.target.value)}
            placeholder="Este servidor exige um segredo pra criar project"
            className={inputClass}
          />
        </Field>
      )}

      <button
        disabled={busy || !project}
        onClick={() => void share()}
        className="flex h-9 w-fit items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
      >
        {published ? <Link2 className="size-3.5" /> : <CloudUpload className="size-3.5" />}
        {busy ? 'Gerando…' : published ? 'Gerar link' : 'Publicar e gerar link'}
      </button>

      {error && <p className="text-sm leading-relaxed text-bad">{error}</p>}
    </div>
  )
}
