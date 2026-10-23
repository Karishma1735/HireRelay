import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchored to this file so the build works from the repo root as well as from client/.
const here = path.dirname(fileURLToPath(import.meta.url))

export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: {
    extend: {
      fontFamily: { sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'] },
      // Cobalt is the one accent; ink is the graphite used for the sidebar and primary buttons.
      colors: {
        brand: { 50: '#EEF2FF', 100: '#E1E9FF', 200: '#C7D4FF', 300: '#A9BEFA', 400: '#7C9AFB', 500: '#4D78FF', 600: '#2F5BFF', 700: '#2447C9', 800: '#1C379A' },
        ink: { 950: '#0D0F14', 900: '#13161C', 800: '#1B2030', 700: '#2A3042', 600: '#3D4560' }
      },
      boxShadow: { card: '0 1px 2px rgba(19,22,28,.04)', pop: '0 12px 30px -12px rgba(19,22,28,.35)', btn: '0 1px 2px rgba(19,22,28,.25), inset 0 1px 0 rgba(255,255,255,.12)' }
    }
  },
  plugins: []
}
