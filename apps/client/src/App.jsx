import { Routes, Route } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import HomePage from './pages/HomePage'
import StarterPage from './pages/StarterPage'
import InventoryPage from './pages/InventoryPage'
import { BattlePage, ExplorePage } from './pages/BattlePage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import MapPage from './pages/game/MapPage'
import EditProfilePage from './pages/EditProfilePage'
import PokemonBoxPage from './pages/PokemonBoxPage'
import PokemonInfoPage from './pages/PokemonInfoPage'
import ChangePartyPage from './pages/ChangePartyPage'

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard'
import PokemonListPage from './pages/admin/PokemonListPage'
import PokemonFormPage from './pages/admin/PokemonFormPage'
import MapListPage from './pages/admin/MapListPage'
import MapFormPage from './pages/admin/MapFormPage'
import DropRateManagerPage from './pages/admin/DropRateManagerPage'
import AdminNewsPage from './pages/admin/AdminNewsPage'
import UserManagementPage from './pages/admin/UserManagementPage'

export default function App() {
    return (
        <Routes>
            {/* Login page - no AppShell */}
            <Route path="/login" element={<LoginPage />} />

            {/* Main app with AppShell */}
            <Route element={<AppShell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/edit" element={<EditProfilePage />} />
                <Route path="/starter" element={<StarterPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/battle" element={<BattlePage />} />
                <Route path="/explore" element={<ExplorePage />} />
                <Route path="/map/:slug" element={<MapPage />} />
                <Route path="/box" element={<PokemonBoxPage />} />
                <Route path="/pokemon/:id" element={<PokemonInfoPage />} />
                <Route path="/party" element={<ChangePartyPage />} />

                {/* Admin Routes */}
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/news" element={<AdminNewsPage />} />
                <Route path="/admin/users" element={<UserManagementPage />} />
                <Route path="/admin/pokemon" element={<PokemonListPage />} />
                <Route path="/admin/pokemon/create" element={<PokemonFormPage />} />
                <Route path="/admin/pokemon/:id/edit" element={<PokemonFormPage />} />
                <Route path="/admin/maps" element={<MapListPage />} />
                <Route path="/admin/maps/create" element={<MapFormPage />} />
                <Route path="/admin/maps/:id/edit" element={<MapFormPage />} />
                <Route path="/admin/maps/:mapId/drop-rates" element={<DropRateManagerPage />} />
            </Route>
        </Routes>
    )
}
