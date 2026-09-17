import { useState } from 'react'
import { CloudUpload, Link2, ShieldAlert } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useStore } from '../store'
import { useSession } from '../sessionStore'
import { CopyField, Field, Modal, Select } from './Modal'
import { inputClass, linkFor } from '../lib/ui'

/** Sharing is an action, not a moment: this machine's key is stored locally and
 *  issues everyone else's, so nobody has to have written a key down. */
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

  /** Publishes the project (if needed) and issues the guest key. */
  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      let key = published ? connection.key! : null
      if (!key) {
        const created = await api.createProject(project!.name, createToken.trim() || undefined)
        // Bind before connecting: the local project becomes the server's, and
        // the first push carries what already lives here.
        adoptRemoteProject({ id: created.id, name: created.name })
        connect(created.key, {
          scope: 'project',
          role: 'write',
          label: 'This machine',
          projectId: created.id,
          projectName: created.name,
          collectionId: null,
        })
        key = created.key
      }
      const issued = await api.createKey(key, {
        label: label.trim() || 'Guest',
        role,
        // A collection key only issues keys for its own collection.
        collectionId:
          connection.scope === 'collection' ? connection.collectionId : scope || null,
      })
      setLink(linkFor(issued.key))
    } catch (err) {
      // 401/403 on create = the server requires the secret; reveal the field.
      if (err instanceof ApiError && [401, 403].includes(err.status) && !published) {
        setNeedsToken(true)
      }
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (readOnly) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldAlert aria-hidden className="size-4 text-warn" />
          Share
        </h2>
        <p className="text-sm leading-relaxed text-ink-dim">
          Your key is read-only, and a read key issues no others. Ask whoever shared this project
          with you for a write key.
        </p>
      </div>
    )
  }

  if (link) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Link ready</h2>
          <p className="text-sm leading-relaxed text-ink-faint">
            Valid until you revoke it under <span className="text-ink-dim">Sync → Active keys</span>.
          </p>
        </div>
        <CopyField value={link} hint="Shown only now — copy it before closing." />
        {/* Issuing another key right after is the rare case: whoever just copied
            the link wants to close. */}
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
            Generate another link
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Share {project ? `"${project.name}"` : 'project'}
        </h2>
        <p className="text-sm leading-relaxed text-ink-faint">
          {published
            ? 'Everyone gets their own key. You never hand out yours.'
            : 'Sharing publishes it on the server and generates the link.'}
        </p>
      </div>

      <Field label="Name" hint="So you recognize the key later.">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void share()}
          placeholder="my-laptop"
          className={inputClass}
        />
      </Field>

      {/* Two equal columns: both controls close at the same width and the same
          height as the field above. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Permission">
          <Select value={role} onChange={(v) => setRole(v as 'write' | 'read')}>
            <option value="read">Read</option>
            <option value="write">Read and write</option>
          </Select>
        </Field>
        {connection.scope === 'collection' ? (
          // A collection key only issues keys for its own collection: nothing to
          // choose, only something to state.
          <Field label="Scope">
            <span className="flex h-9 items-center truncate text-sm text-ink-dim">
              Collection — {lockedCollection?.name ?? '—'}
            </span>
          </Field>
        ) : (
          <Field label="Scope">
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
        <Field label="Server secret">
          <input
            value={createToken}
            onChange={(e) => setCreateToken(e.target.value)}
            placeholder="This server requires a secret to create a project"
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
        {busy ? 'Generating…' : published ? 'Generate link' : 'Publish and generate link'}
      </button>

      {error && <p className="text-sm leading-relaxed text-bad">{error}</p>}
    </div>
  )
}
