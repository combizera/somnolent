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
 ├── Collection (a unidade que você abre na sidebar — "Catcher v1", "Piped"...)
 │    ├── Pasta (subcollection, aninhável)
 │    │    └── Request
 │    └── Request (método, URL, headers, query, body — tudo aceita {{var}})
 └── Environment (staging, prod, local...)
      └── Variables { base_url: "...", token: "...", ... }
```

- **Workspace**: unidade de colaboração e de sync. Tem membros.
- **Collection**: o nível de topo da sidebar, como no Insomnia — a sidebar lista as collections e você **entra** numa delas pra ver as requests. Isso evita misturar duas APIs no mesmo aside. Tecnicamente collection e pasta são a mesma entidade (`Collection` com `parentId`): collection é a que tem `parentId: null`. A collection aberta é escolha local de quem navega e não sincroniza.
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
| Desktop (Linux/Win/macOS) | **Tauri v2** | Binário ~10 MB vs ~150 MB do Electron, menos RAM, empacota o mesmo app web. `bundle.targets: "all"` gera `.deb`/`.AppImage`/`.msi`/`.app`/`.dmg` — o CI bundla só Linux e Windows; macOS builda local (ver §4) |
| Backend (sync) | **Node + Fastify + TypeScript** | Mesmo idioma do front, API pequena |
| Banco | **PostgreSQL + Drizzle ORM** | Confiável, tipado, migrations simples |
| Auth | **Chave de acesso por link** | Sem conta e sem senha: a chave é a credencial. Várias por project, cada uma com rótulo e papel, revogáveis uma a uma |
| Editor de body | **CodeMirror 6** | Leve (Monaco é pesado demais pra isso), highlight de JSON e de `{{var}}` |
| Monorepo | **pnpm workspaces** | `apps/web`, `apps/desktop`, `apps/server`, `packages/core` |

### Por que Tauri e não Electron?

- O app é essencialmente uma UI sobre `fetch` — não precisa de Node no cliente.
- Tauri usa a webview do sistema: instalador pequeno, pouca RAM, e o build pra Linux + Windows sai do mesmo GitHub Actions.
- Bônus real: na versão web, requests a APIs de terceiros esbarram em **CORS**; no Tauri dá pra mandar o request pelo lado Rust (plugin HTTP) e escapar do CORS de vez.

> ⚠️ **Estado atual:** o `tauri-plugin-http` **ainda não está instalado** (o `Cargo.toml` só tem `tauri` + `tauri-plugin-log`, e as capabilities só têm `core:default`). Hoje o send usa o `fetch` da webview nas duas versões, então o desktop **também sofre CORS**. A única saída de CORS que já funciona é o **proxy no server** (`POST /proxy`), acionado como fallback automático quando o `fetch` falha — e ele exige estar logado. Trocar o transporte do desktop pelo plugin HTTP está no backlog da Fase 3.

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
- Cliente salva → `POST /workspaces/:id/sync` com `{ since, changes, deletes }` → servidor responde com o que mudou do outro lado desde o `since` (push e pull na mesma chamada).
- Clientes conectados recebem a mudança via **WebSocket** (`/workspaces/:id/ws`), com polling de 20s como rede de segurança caso o socket caia calado.
- Conflito (raro: duas pessoas editando a mesma request)? **Last-write-wins** + aviso na UI. Pro caso de uso "meu colega valida as infos", isso resolve 100%.
- Cache local em `localStorage`/arquivo pra abrir instantâneo e funcionar offline-read.

## 4. Como rodar (Linux/WSL e macOS)

### Pré-requisitos

| | Linux / WSL | macOS |
|---|---|---|
| Node 24 | `nvm install 24` | `brew install node@24` (ou `nvm`) |
| pnpm 11.20 | `corepack enable` (a versão vem do `packageManager` no `package.json`) | idem |
| Postgres | `docker compose up -d` | Docker Desktop **ou** OrbStack (mais leve) + `docker compose up -d` |
| Só pro desktop (Tauri) | `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` + `rustup` | `xcode-select --install` + `rustup` — a webview é a do sistema (WKWebView), nada de lib extra |

### Subir tudo

```bash
pnpm install
docker compose up -d                    # Postgres em localhost:5435
pnpm --filter @somnolent/server dev     # API em http://localhost:4000 (roda as migrations no boot)
pnpm dev                                # web em http://localhost:5173
pnpm desktop                            # opcional: Tauri (sobe o Vite sozinho via beforeDevCommand)
```

**Não precisa de `.env`** — tudo tem default no código: `DATABASE_URL` (`postgres://postgres:somnolent@localhost:5435/somnolent`), `PORT=4000` no server e `VITE_API_URL=http://localhost:4000` na web. Sobrescreva só se precisar. Opcional: `PROJECT_CREATE_TOKEN` fecha a criação de project (sem ele, qualquer um cria — tudo bem no local, não num deploy).

Testes (`pnpm test`, 61 no total) **não precisam de Docker** — o server roda contra PGlite em memória.

### Testando num Mac (ex.: fora de casa)

- **Baixe as coisas antes de sair**, wifi de cafeteria não ajuda: `pnpm install`, `docker pull postgres:16-alpine` e — se quiser o desktop — um `pnpm desktop` pra popular o cache do Cargo (o primeiro build compila algumas centenas de crates, ~5 min e ~1 GB em `src-tauri/target/`).
- **Caminho mais rápido:** só `pnpm dev` no navegador. Não precisa de Rust nem de Xcode; a Fase 1 inteira (requests, environments, import, cURL, palette) funciona sem server e sem Docker, porque persiste em `localStorage`.
- **Seus dados não viajam.** O workspace mora em `localStorage` na chave `somnolent-workspace`, por máquina e por browser — o Mac começa vazio. E **não existe export de workspace ainda** (só import de Insomnia/cURL), então as opções são: reimportar o export do Insomnia, usar o sync, ou copiar o valor da chave `somnolent-workspace` na mão pelo devtools.
- **Pra testar o sync no Mac** enquanto não existe deploy (Fase 4): rode o server local no próprio Mac (workspace novo, isolado), ou aponte `VITE_API_URL` pro server da outra máquina na mesma rede (`VITE_API_URL=http://192.168.x.x:4000 pnpm dev` — o server já escuta em `0.0.0.0`). Fora da mesma rede, só depois do deploy.
- **Bundle desktop no Mac:** `pnpm --filter @somnolent/desktop bundle` → `.app`/`.dmg` em `apps/desktop/src-tauri/target/release/bundle/`. O `icon.icns` já está no repo e `bundle.targets` é `"all"`, então não precisa mexer em config. O binário não é assinado nem notarizado — no primeiro open o Gatekeeper reclama; abra pelo menu de contexto → *Open*.
- **macOS não está na matriz do CI** (só `ubuntu-latest` e `windows-latest`), então nesse ponto o Mac é build local.

## 5. Roadmap

### Fase 0 — Fundação ✅
- [x] Monorepo pnpm + Vite + React + Tailwind + Tauri configurados
- [x] `packages/core`: tipos (Workspace, Collection, Request, Environment) + engine de resolução de `{{vars}}` **com testes** (é o coração do app)
- [x] CI: lint, testes, build web e build Tauri (Linux + Windows)

### Fase 1 — Cliente HTTP local ✅ → *usável sozinho, sem servidor*
- [x] Layout 3 painéis: sidebar (collections) · request · response
- [x] Sidebar em 2 níveis: lista de collections → entra numa e vê as pastas/requests dela
- [x] Montar e enviar request: método, URL, headers, query params, body JSON
- [x] Ver response: status, tempo, tamanho, body com highlight, headers
- [x] CRUD de collections e requests (persistência local em localStorage)
- [x] **Environments**: CRUD de envs e variáveis, base environment, seletor no topo com troca de env em 1 clique (+ cor de destaque da UI segue o env ativo — staging âmbar, prod vermelho)
- [x] `{{var}}` resolvido no send + highlight das variáveis na URL/headers (verde = resolvida, vermelho = faltando)
- [x] Autocomplete de `{{vars}}`: abrir `{{` lista as variáveis do environment (URL, headers, query params e auth; o body em CodeMirror ainda não)
- [x] Histórico simples de responses (últimas 20 por request)

### Fase 2 — Sync e colaboração → **MVP lançável**
- [x] Server: chaves de acesso com escopo (project ou collection) e papel (escrita ou leitura), sem contas — criar project devolve a primeira chave, `POST /keys` emite outras, `DELETE /keys/:id` revoga na hora
- [x] Sync push/pull incremental (`since`) + last-write-wins por `updatedAt` + tombstones de deleção; o escopo vem da chave, não da URL
- [x] Compartilhar um project inteiro ou uma collection avulsa por link (a chave viaja no fragmento, que não chega ao servidor)
- [x] WebSocket para atualização em tempo quase-real (+ polling de 20s como fallback)
- [x] Variáveis secretas (valor local-only — sync propaga a chave com valor vazio)
- [x] Proxy CORS no server (`POST /proxy`, fallback automático quando o `fetch` do navegador falha — exige estar logado)
- [ ] Deploy → detalhado na Fase 4

**🚀 MVP = fim da Fase 2.** Você e seu colega no mesmo workspace, trocando de env com 1 clique. Estimativa: ~5 semanas.

### Fase 3 — Pós-MVP
- [x] Import do Insomnia **v5 (YAML)** e **v4 (JSON)**, com detecção automática de formato: todo o export entra em **uma** collection nomeada pelo documento, com as pastas aninhadas preservadas como subpastas, requests, query params (inclusive desabilitados), body, descrições, `pathParameters` (`:id` substituído pelo valor), auth bearer/basic, environments com cor, e `{{ _.var }}` → `{{ var }}`
- [x] Variáveis de credencial (`token`, `secret`, `password`, `api_key`…) entram marcadas como **secretas** no import — valor fica local, não sobe no sync
- [x] Relatório pós-import: contagem de requests/pastas/environments + avisos (path param vazio, token literal fora de variável)
- [x] Import de cURL (cola o comando no modal de importar) e "copiar como cURL" (resolvido no env ativo)
- [x] Auth helpers (Bearer/Basic com suporte a `{{vars}}`; header manual tem precedência)
- [x] Busca global (Ctrl/Cmd+K) por nome, URL e método
- [x] Duplicar request (botão ⧉ na sidebar)
- [x] Arrastar para reorganizar: reordenar requests, mover entre pastas, tirar da pasta e reordenar pastas — a posição vive em `sortOrder` e viaja no sync
- [ ] Variáveis de resposta encadeadas (`{{ response.body.token }}`)
- [ ] `tauri-plugin-http`: mandar o send pelo lado Rust no desktop e matar o CORS de vez (hoje o desktop usa o `fetch` da webview — ver aviso na §3)
- [ ] Export do workspace pra arquivo (hoje só existe import) — resolve levar os dados pra outra máquina sem servidor
- [ ] Autocomplete de `{{vars}}` no body (CodeMirror), OAuth Google, temas, mais atalhos de teclado

### Fase 4 — Deploy (próxima)
- [ ] Server + Postgres (Railway/Fly.io), web (Vercel/Cloudflare), releases desktop no GitHub
- [ ] `macos-latest` na matriz do CI (hoje só Linux e Windows) pra sair `.dmg` assinado junto das releases

## 6. Riscos e decisões em aberto

| Risco | Mitigação |
|---|---|
| CORS na web **e no desktop** (a webview do Tauri também é um navegador) | Proxy no backend já cobre o caso, mas exige login. Saída definitiva pro desktop: `tauri-plugin-http` (Fase 3) |
| Escopo crescer ("só mais essa feature do Insomnia...") | Este documento é o contrato de escopo do MVP |
| Conflitos de edição simultânea | Last-write-wins + aviso; CRDT só se virar problema real |
| Segredos no servidor | Variáveis secretas nunca saem da máquina no MVP |

## 7. Definição de sucesso do MVP

> Eu crio o workspace, defino `staging` e `prod` com `base_url` e `token`, escrevo as requests uma vez, aperto um botão pra trocar de ambiente, e meu colega entra no workspace e valida as mesmas requests na máquina dele — sem exportar/importar arquivo nenhum.
