import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'Safari >= 12'],
      modernPolyfills: true,
    }),
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = String(id || '').replace(/\\/g, '/')

          if (normalized.includes('/node_modules/')) {
            return 'vendor'
          }

          if (normalized.includes('/src/pages/admin/')) {
            if (normalized.includes('/src/pages/admin/AdminDashboard.jsx')) {
              return 'admin-dashboard'
            }

            if (normalized.includes('/src/pages/admin/AdminNewsPage.jsx')) {
              return 'admin-news'
            }

            if (
              normalized.includes('/src/pages/admin/UserManagementPage.jsx')
              || normalized.includes('/src/pages/admin/VipPrivilegePage.jsx')
            ) {
              return 'admin-users'
            }

            if (
              normalized.includes('/src/pages/admin/PokemonListPage.jsx')
              || normalized.includes('/src/pages/admin/PokemonFormPage.jsx')
            ) {
              return 'admin-pokemon'
            }

            if (
              normalized.includes('/src/pages/admin/MapListPage.jsx')
              || normalized.includes('/src/pages/admin/MapFormPage.jsx')
              || normalized.includes('/src/pages/admin/DropRateManagerPage.jsx')
              || normalized.includes('/src/pages/admin/ItemDropRateManagerPage.jsx')
            ) {
              return 'admin-maps'
            }

            if (normalized.includes('/src/pages/admin/BattleTrainerPage.jsx')) {
              return 'admin-battle'
            }

            if (
              normalized.includes('/src/pages/admin/ItemListPage.jsx')
              || normalized.includes('/src/pages/admin/ItemFormPage.jsx')
              || normalized.includes('/src/pages/admin/MoveListPage.jsx')
              || normalized.includes('/src/pages/admin/MoveFormPage.jsx')
            ) {
              return 'admin-catalog'
            }

            if (
              normalized.includes('/src/pages/admin/DailyRewardManagerPage.jsx')
              || normalized.includes('/src/pages/admin/WeeklyLeaderboardRewardPage.jsx')
              || normalized.includes('/src/pages/admin/PromoCodeManagerPage.jsx')
            ) {
              return 'admin-rewards'
            }
          }

          if (normalized.includes('/src/pages/BattlePage.jsx')) {
            return 'route-battle'
          }

          if (normalized.includes('/src/pages/game/MapPage.jsx')) {
            return 'route-map'
          }

          if (
            normalized.includes('/src/pages/PokedexPage.jsx')
            || normalized.includes('/src/pages/PokemonRarityPage.jsx')
            || normalized.includes('/src/pages/PokemonRankingsPage.jsx')
            || normalized.includes('/src/pages/RankingsPage.jsx')
          ) {
            return 'route-pokedex'
          }

          if (
            normalized.includes('/src/pages/PokemonBoxPage.jsx')
            || normalized.includes('/src/pages/PokemonInfoPage.jsx')
            || normalized.includes('/src/pages/ChangePartyPage.jsx')
            || normalized.includes('/src/pages/EvolvePage.jsx')
          ) {
            return 'route-pokemon-box'
          }

          if (normalized.includes('/src/pages/LoginPage.jsx')) {
            return 'route-auth'
          }

          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
