# Somnolent

> Um cliente HTTP simples e colaborativo — a alternativa leve ao Insomnia.

## 1. Visão

O Insomnia ficou pesado, bugado e o modelo de colaboração é ruim. O Somnolent nasce com um escopo enxuto e três pilares inegociáveis:

1. **Variáveis de ambiente** — templating nas requests (`{{ base_url }}`, `{{ token }}`) pra não repetir nada e melhorar a DX.
2. **Environments trocáveis com 1 clique** — mudar de `staging` pra `prod` num botão e **todas** as variáveis (URL, token, headers) mudam junto. A request é escrita uma vez; o environment resolve os valores.
3. **Sync colaborativo** — o workspace vive no servidor. Um colega abre o mesmo workspace e vê as mesmas collections, requests e environments, sempre atualizados.

Tudo que o Insomnia tem além disso (gRPC, GraphQL explorer, mocks, testes, plugins) fica **fora do MVP**. Simplicidade é feature.

## 2. Conceitos / Modelo de dados

```
Workspace
 ├── Collection (pasta, aninhável)
 │    └── Request (método, URL, headers, query, body — tudo aceita {{var}})
 └── Environment (staging, prod, local...)
      └── Variables { base_url: "...", token: "...", ... }
```

- **Workspace**: unidade de colaboração e de sync. Tem membros.
- **Request**: nunca guarda valores finais de URL/token — guarda templates. Ex.: `{{ base_url }}/v1/clients`.
- **Environment**: um dicionário chave→valor. O environment **ativo** é escolha local de cada usuário (eu posso estar em `staging` enquanto meu colega valida em `prod` — o ativo não sincroniza, os environments em si sim).
- **Base environment** (herança simples): variáveis comuns a todos os envs ficam no base; cada env sobrescreve o que precisa. É o mesmo modelo do Insomnia e resolve 90% dos casos.
- **Resolução**: `valores = base ⊕ env_ativo`, aplicados na hora do send com `{{ var }}` (sintaxe estilo Handlebars, sem lógica — só substituição).

### Segredos (decisão importante pro sync)

Tokens de prod não deveriam ir pro servidor em texto puro. Pro MVP, abordagem pragmática em 2 níveis:

- Variável normal → sincroniza.
- Variável marcada como **secreta** → fica **só na máquina local** (cada membro preenche a sua). O sync propaga a *existência* da chave, não o valor. Simples, seguro e evita criptografia E2E no MVP.

## 3. Tech Stack

**Princípio: um só codebase TypeScript pra web e desktop.**

| Camada | Escolha | Por quê |
|---|---|---|
| UI | **React + TypeScript + Vite** | Ecossistema, velocidade de dev, vocês já conhecem |
| Estado | **Zustand** | Mínimo de boilerplate, perfeito pro tamanho do app |
| Estilo | **Tailwind CSS** | Rápido de iterar, fácil manter consistência |
| Desktop (Linux/Win) | **Tauri v2** | Binário ~10 MB vs ~150 MB do Electron, menos RAM, empacota o mesmo app web. Instaladores `.deb`/`.AppImage`/`.msi` prontos no CI |
| Backend (sync) | **Node + Fastify + TypeScript** | Mesmo idioma do front, API pequena |
| Banco | **PostgreSQL + Drizzle ORM** | Confiável, tipado, migrations simples |
| Auth | **E-mail + senha com JWT** (MVP) | Sem dependência externa; OAuth Google depois |
| Editor de body | **CodeMirror 6** | Leve (Monaco é pesado demais pra isso), highlight de JSON e de `{{var}}` |
| Monorepo | **pnpm workspaces** | `apps/web`, `apps/desktop`, `apps/server`, `packages/core` |

### Por que Tauri e não Electron?

- O app é essencialmente uma UI sobre `fetch` — não precisa de Node no cliente.
- Tauri usa a webview do sistema: instalador pequeno, pouca RAM, e o build pra Linux + Windows sai do mesmo GitHub Actions.
- Bônus real: na versão web, requests a APIs de terceiros esbarram em **CORS**; no Tauri o request sai pelo lado Rust (plugin HTTP) e não tem CORS. A versão web usa um pequeno proxy no próprio backend pra contornar isso.

### Estrutura do monorepo

```
somnolent/
├── apps/
│   ├── web/        # React app (deploy na Vercel/Cloudflare)
│   ├── desktop/    # Tauri — embrulha o mesmo app web
│   └── server/     # Fastify: auth, workspaces, sync
├── packages/
│   └── core/       # tipos compartilhados, resolução de {{vars}}, client de sync
└── package.json    # pnpm workspaces
```

### Estratégia de sync (MVP: simples e suficiente)

Nada de CRDT/Yjs por enquanto — é overkill pra um time pequeno editando requests.

- Toda entidade tem `updated_at` e `version`.
- Cliente salva → `PATCH` no servidor → servidor incrementa `version`.
- Clientes conectados recebem a mudança via **WebSocket** (ou polling de 10s como fallback — funciona e é trivial).
- Conflito (raro: duas pessoas editando a mesma request)? **Last-write-wins** + aviso na UI. Pro caso de uso "meu colega valida as infos", isso resolve 100%.
- Cache local em `localStorage`/arquivo pra abrir instantâneo e funcionar offline-read.

## 4. Roadmap

### Fase 0 — Fundação ✅
- [x] Monorepo pnpm + Vite + React + Tailwind + Tauri configurados
- [x] `packages/core`: tipos (Workspace, Collection, Request, Environment) + engine de resolução de `{{vars}}` **com testes** (é o coração do app)
- [x] CI: lint, testes, build web e build Tauri (Linux + Windows)

### Fase 1 — Cliente HTTP local ✅ → *usável sozinho, sem servidor*
- [x] Layout 3 painéis: sidebar (collections) · request · response
- [x] Montar e enviar request: método, URL, headers, query params, body JSON
- [x] Ver response: status, tempo, tamanho, body com highlight, headers
- [x] CRUD de collections e requests (persistência local em localStorage)
- [x] **Environments**: CRUD de envs e variáveis, base environment, seletor no topo com troca de env em 1 clique (+ cor de destaque da UI segue o env ativo — staging âmbar, prod vermelho)
- [x] `{{var}}` resolvido no send + highlight das variáveis na URL/headers (verde = resolvida, vermelho = faltando) — *autocomplete ficou pro backlog*
- [x] Histórico simples de responses (últimas 20 por request)

### Fase 2 — Sync e colaboração → **MVP lançável**
- [x] Server: auth (registro/login com JWT), CRUD de workspaces, membros por código de convite
- [x] Sync push/pull incremental (`since`) + last-write-wins por `updatedAt` + tombstones de deleção
- [x] WebSocket para atualização em tempo quase-real (+ polling de 20s como fallback)
- [x] Variáveis secretas (valor local-only — sync propaga a chave com valor vazio)
- [x] Proxy CORS no server (fallback automático na versão web quando o navegador bloqueia)
- [ ] Deploy: server (Railway/Fly.io) + web (Vercel) + releases desktop no GitHub

*Dev local: `docker compose up -d` (Postgres na porta 5435) + `pnpm --filter @somnolent/server dev` + `pnpm dev`. Testes do server rodam com PGlite em memória (sem Docker).*

**🚀 MVP = fim da Fase 2.** Você e seu colega no mesmo workspace, trocando de env com 1 clique. Estimativa: ~5 semanas.

### Fase 3 — Pós-MVP
- [x] Import do Insomnia **v5 (YAML)** e **v4 (JSON)**, com detecção automática de formato: pastas aninhadas (achatadas como "Pai / Filho"), requests, query params (inclusive desabilitados), body, descrições, `pathParameters` (`:id` substituído pelo valor), auth bearer/basic, environments com cor, e `{{ _.var }}` → `{{ var }}`
- [x] Variáveis de credencial (`token`, `secret`, `password`, `api_key`…) entram marcadas como **secretas** no import — valor fica local, não sobe no sync
- [x] Relatório pós-import: contagem de requests/pastas/environments + avisos (path param vazio, token literal fora de variável)
- [x] Import de cURL (cola o comando no modal de importar) e "copiar como cURL" (resolvido no env ativo)
- [x] Auth helpers (Bearer/Basic com suporte a `{{vars}}`; header manual tem precedência)
- [x] Busca global (Ctrl/Cmd+K) por nome, URL e método
- [x] Duplicar request (botão ⧉ na sidebar)
- [x] Arrastar para reorganizar: reordenar requests, mover entre pastas, tirar da pasta e reordenar pastas — a posição vive em `sortOrder` e viaja no sync
- [ ] Variáveis de resposta encadeadas (`{{ response.body.token }}`)
- [ ] OAuth Google, temas, mais atalhos de teclado

### Fase 4 — Deploy (próxima)
- [ ] Server + Postgres (Railway/Fly.io), web (Vercel/Cloudflare), releases desktop no GitHub

## 5. Riscos e decisões em aberto

| Risco | Mitigação |
|---|---|
| CORS na versão web | Proxy no backend (desktop não sofre disso) |
| Escopo crescer ("só mais essa feature do Insomnia...") | Este documento é o contrato de escopo do MVP |
| Conflitos de edição simultânea | Last-write-wins + aviso; CRDT só se virar problema real |
| Segredos no servidor | Variáveis secretas nunca saem da máquina no MVP |

## 6. Definição de sucesso do MVP

> Eu crio o workspace, defino `staging` e `prod` com `base_url` e `token`, escrevo as requests uma vez, aperto um botão pra trocar de ambiente, e meu colega entra no workspace e valida as mesmas requests na máquina dele — sem exportar/importar arquivo nenhum.
