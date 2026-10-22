import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchored to this file so the build works from the repo root as well as from client/.
const here = path.dirname(fileURLToPath(import.meta.url))

export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: { brand: { 50: '#EEEEFE', 100: '#E1E1FD', 200: '#C7C7F8', 300: '#A5A5F5', 400: '#7B7BF2', 500: '#6666F1', 600: '#5B5BF0', 700: '#4545D6', 800: '#3636AA' } },
      boxShadow: { card: '0 1px 0 rgba(255,255,255,.8) inset, 0 10px 30px -14px rgba(30,30,80,.18)', glow: '0 10px 24px -8px rgba(91,91,240,.45)' }
    }
  },
  plugins: []
}
