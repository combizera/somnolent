import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * URL pública do app, usada só nas meta tags de OG/Twitter — que exigem URL
 * absoluta, porque crawler não resolve caminho relativo. Trocar de domínio é
 * mudar `VITE_SITE_URL`, não caçar ocorrência no HTML.
 */
const FALLBACK_SITE_URL = 'https://combizera-somnolent-web.wlq5xk.easypanel.host'

export default defineConfig(({ mode }) => {
  // loadEnv, e não process.env: o Vite não injeta o .env no process, então ler
  // dali faria a variável funcionar como env de shell e ser ignorada no .env.
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  // Variável vazia é o caso real do painel de deploy com o campo em branco —
  // sem o `||`, as meta tags sairiam com URL relativa.
  const siteUrl = (env.VITE_SITE_URL?.trim() || FALLBACK_SITE_URL).replace(/\/+$/, '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'somnolent-site-url',
        transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl),
      },
    ],
    // Porta fixa pro Tauri apontar no dev
    server: { port: 5173, strictPort: true },
  }
})
