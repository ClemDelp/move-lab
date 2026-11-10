import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relatif : fonctionne aussi bien en local que sur GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
})
