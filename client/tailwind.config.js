import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchored to this file so the build works from the repo root as well as from client/.
const here = path.dirname(fileURLToPath(import.meta.url))

export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: { extend: { fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] } } },
  plugins: []
}
