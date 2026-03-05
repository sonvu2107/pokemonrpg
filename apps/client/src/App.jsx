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
import PokedexPage from './pages/PokedexPage'
import RankingsPage from './pages/RankingsPage'
import PokemonRankingsPage from './pages/PokemonRankingsPage'
import EvolvePage from './pages/EvolvePage'
import TradesPage from './pages/TradesPage'
import ShopSellPage from './pages/ShopSellPage'
import ItemShopPage from './pages/ItemShopPage'
import ItemInfoPage from './pages/ItemInfoPage'
import SkillShopPage from './pages/SkillShopPage'
import DailyStatsPage from './pages/DailyStatsPage'
import OnlineStatsPage from './pages/OnlineStatsPage'
import DailyCheckInPage from './pages/DailyCheckInPage'
import PromoCodePage from './pages/PromoCodePage'
import FriendsPage from './pages/FriendsPage'

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard'
import PokemonListPage from './pages/admin/PokemonListPage'
import PokemonFormPage from './pages/admin/PokemonFormPage'
import MapListPage from './pages/admin/MapListPage'
import MapFormPage from './pages/admin/MapFormPage'
import DropRateManagerPage from './pages/admin/DropRateManagerPage'
import ItemListPage from './pages/admin/ItemListPage'
import ItemFormPage from './pages/admin/ItemFormPage'
import MoveListPage from './pages/admin/MoveListPage'
import MoveFormPage from './pages/admin/MoveFormPage'
import ItemDropRateManagerPage from './pages/admin/ItemDropRateManagerPage'
import AdminNewsPage from './pages/admin/AdminNewsPage'
import UserManagementPage from './pages/admin/UserManagementPage'
import BattleTrainerPage from './pages/admin/BattleTrainerPage'
import DailyRewardManagerPage from './pages/admin/DailyRewardManagerPage'
import PromoCodeManagerPage from './pages/admin/PromoCodeManagerPage'
import AdminRouteGuard from './components/AdminRouteGuard'
import { ADMIN_PERMISSIONS } from './constants/adminPermissions'

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
                <Route path="/pokedex" element={<PokedexPage />} />
                <Route path="/pokemon/:id" element={<PokemonInfoPage />} />
                <Route path="/items/:id" element={<ItemInfoPage />} />
                <Route path="/pokemon/:id/evolve" element={<EvolvePage />} />
                <Route path="/evolve" element={<EvolvePage />} />
                <Route path="/party" element={<ChangePartyPage />} />
                <Route path="/rankings/overall" element={<RankingsPage />} />
                <Route path="/rankings/pokemon" element={<PokemonRankingsPage />} />
                <Route path="/rankings/daily" element={<RankingsPage />} />
                <Route path="/shop/buy" element={<TradesPage />} />
                <Route path="/shop/sell" element={<ShopSellPage />} />
                <Route path="/shop/items" element={<ItemShopPage />} />
                <Route path="/shop/skills" element={<SkillShopPage />} />
                <Route path="/stats" element={<DailyStatsPage />} />
                <Route path="/stats/online" element={<OnlineStatsPage />} />
                <Route path="/daily" element={<DailyCheckInPage />} />
                <Route path="/promo" element={<PromoCodePage />} />
                <Route path="/trades" element={<TradesPage />} />
                <Route path="/friends" element={<FriendsPage />} />

                {/* Admin Routes */}
                <Route path="/admin" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
                <Route path="/admin/news" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.NEWS}><AdminNewsPage /></AdminRouteGuard>} />
                <Route path="/admin/events" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.NEWS}><AdminNewsPage mode="events" /></AdminRouteGuard>} />
                <Route path="/admin/users" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.USERS}><UserManagementPage /></AdminRouteGuard>} />
                <Route path="/admin/pokemon" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.POKEMON}><PokemonListPage /></AdminRouteGuard>} />
                <Route path="/admin/pokemon/create" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.POKEMON}><PokemonFormPage /></AdminRouteGuard>} />
                <Route path="/admin/pokemon/:id/edit" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.POKEMON}><PokemonFormPage /></AdminRouteGuard>} />
                <Route path="/admin/maps" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MAPS}><MapListPage /></AdminRouteGuard>} />
                <Route path="/admin/maps/create" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MAPS}><MapFormPage /></AdminRouteGuard>} />
                <Route path="/admin/maps/:id/edit" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MAPS}><MapFormPage /></AdminRouteGuard>} />
                <Route path="/admin/maps/:mapId/drop-rates" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MAPS}><DropRateManagerPage /></AdminRouteGuard>} />
                <Route path="/admin/maps/:mapId/item-drop-rates" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MAPS}><ItemDropRateManagerPage /></AdminRouteGuard>} />
                <Route path="/admin/items" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.ITEMS}><ItemListPage /></AdminRouteGuard>} />
                <Route path="/admin/items/create" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.ITEMS}><ItemFormPage /></AdminRouteGuard>} />
                <Route path="/admin/items/:id/edit" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.ITEMS}><ItemFormPage /></AdminRouteGuard>} />
                <Route path="/admin/moves" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MOVES}><MoveListPage /></AdminRouteGuard>} />
                <Route path="/admin/moves/create" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MOVES}><MoveFormPage /></AdminRouteGuard>} />
                <Route path="/admin/moves/:id/edit" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.MOVES}><MoveFormPage /></AdminRouteGuard>} />
                <Route path="/admin/battle" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.BATTLE}><BattleTrainerPage /></AdminRouteGuard>} />
                <Route path="/admin/daily-rewards" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.REWARDS}><DailyRewardManagerPage /></AdminRouteGuard>} />
                <Route path="/admin/promo-codes" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.CODES}><PromoCodeManagerPage /></AdminRouteGuard>} />
            </Route>
        </Routes>
    )
}
