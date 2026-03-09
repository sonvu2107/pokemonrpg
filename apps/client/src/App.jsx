import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import AdminRouteGuard from './components/AdminRouteGuard'
import { ADMIN_PERMISSIONS } from './constants/adminPermissions'

const AppShell = lazy(() => import('./layouts/AppShell'))
const HomePage = lazy(() => import('./pages/HomePage'))
const StarterPage = lazy(() => import('./pages/StarterPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const BattlePage = lazy(() => import('./pages/BattlePage').then((module) => ({ default: module.BattlePage })))
const ExplorePage = lazy(() => import('./pages/BattlePage').then((module) => ({ default: module.ExplorePage })))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const MapPage = lazy(() => import('./pages/game/MapPage'))
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'))
const PokemonBoxPage = lazy(() => import('./pages/PokemonBoxPage'))
const PokemonInfoPage = lazy(() => import('./pages/PokemonInfoPage'))
const ChangePartyPage = lazy(() => import('./pages/ChangePartyPage'))
const PokedexPage = lazy(() => import('./pages/PokedexPage'))
const RankingsPage = lazy(() => import('./pages/RankingsPage'))
const PokemonRankingsPage = lazy(() => import('./pages/PokemonRankingsPage'))
const PokemonRarityPage = lazy(() => import('./pages/PokemonRarityPage'))
const EvolvePage = lazy(() => import('./pages/EvolvePage'))
const TradesPage = lazy(() => import('./pages/TradesPage'))
const ShopSellPage = lazy(() => import('./pages/ShopSellPage'))
const ItemShopPage = lazy(() => import('./pages/ItemShopPage'))
const MoonShopPage = lazy(() => import('./pages/MoonShopPage'))
const ItemInfoPage = lazy(() => import('./pages/ItemInfoPage'))
const SkillShopPage = lazy(() => import('./pages/SkillShopPage'))
const DailyStatsPage = lazy(() => import('./pages/DailyStatsPage'))
const OnlineStatsPage = lazy(() => import('./pages/OnlineStatsPage'))
const DailyCheckInPage = lazy(() => import('./pages/DailyCheckInPage'))
const PromoCodePage = lazy(() => import('./pages/PromoCodePage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const NewsDetailPage = lazy(() => import('./pages/NewsDetailPage'))
const ValleyPage = lazy(() => import('./pages/ValleyPage'))
const AuctionsPage = lazy(() => import('./pages/AuctionsPage'))
const GlobalRateLimitModal = lazy(() => import('./components/GlobalRateLimitModal'))

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const PokemonListPage = lazy(() => import('./pages/admin/PokemonListPage'))
const PokemonFormPage = lazy(() => import('./pages/admin/PokemonFormPage'))
const MapListPage = lazy(() => import('./pages/admin/MapListPage'))
const MapFormPage = lazy(() => import('./pages/admin/MapFormPage'))
const DropRateManagerPage = lazy(() => import('./pages/admin/DropRateManagerPage'))
const ItemListPage = lazy(() => import('./pages/admin/ItemListPage'))
const ItemFormPage = lazy(() => import('./pages/admin/ItemFormPage'))
const MoveListPage = lazy(() => import('./pages/admin/MoveListPage'))
const MoveFormPage = lazy(() => import('./pages/admin/MoveFormPage'))
const ItemDropRateManagerPage = lazy(() => import('./pages/admin/ItemDropRateManagerPage'))
const AdminNewsPage = lazy(() => import('./pages/admin/AdminNewsPage'))
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'))
const VipPrivilegePage = lazy(() => import('./pages/admin/VipPrivilegePage'))
const BattleTrainerPage = lazy(() => import('./pages/admin/BattleTrainerPage'))
const DailyRewardManagerPage = lazy(() => import('./pages/admin/DailyRewardManagerPage'))
const PromoCodeManagerPage = lazy(() => import('./pages/admin/PromoCodeManagerPage'))
const WeeklyLeaderboardRewardPage = lazy(() => import('./pages/admin/WeeklyLeaderboardRewardPage'))
const AuctionManagementPage = lazy(() => import('./pages/admin/AuctionManagementPage'))

const RouteLoadingFallback = () => (
    <div className="mx-auto max-w-3xl py-10 text-center text-sm font-bold text-slate-500">
        Đang tải trang...
    </div>
)

export default function App() {
    return (
        <Suspense fallback={<RouteLoadingFallback />}>
            <GlobalRateLimitModal />
            <Routes>
                {/* Login page - no AppShell */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<LoginPage />} />
                <Route path="/forgot-password" element={<LoginPage />} />
                <Route path="/reset-password" element={<LoginPage />} />

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
                    <Route path="/rankings/rarity" element={<PokemonRarityPage />} />
                    <Route path="/rankings/daily" element={<RankingsPage />} />
                    <Route path="/shop/buy" element={<TradesPage />} />
                    <Route path="/shop/sell" element={<ShopSellPage />} />
                    <Route path="/shop/items" element={<ItemShopPage />} />
                    <Route path="/shop/moon" element={<MoonShopPage />} />
                    <Route path="/shop/skills" element={<SkillShopPage />} />
                    <Route path="/stats" element={<DailyStatsPage />} />
                    <Route path="/stats/online" element={<OnlineStatsPage />} />
                    <Route path="/daily" element={<DailyCheckInPage />} />
                    <Route path="/promo" element={<PromoCodePage />} />
                    <Route path="/trades" element={<TradesPage />} />
                    <Route path="/friends" element={<FriendsPage />} />
                    <Route path="/news/:id" element={<NewsDetailPage />} />
                    <Route path="/valley" element={<ValleyPage />} />
                    <Route path="/auctions" element={<AuctionsPage />} />

                    {/* Admin Routes */}
                    <Route path="/admin" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
                    <Route path="/admin/news" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.NEWS}><AdminNewsPage /></AdminRouteGuard>} />
                    <Route path="/admin/events" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.NEWS}><AdminNewsPage mode="events" /></AdminRouteGuard>} />
                    <Route path="/admin/users" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.USERS}><UserManagementPage /></AdminRouteGuard>} />
                    <Route path="/admin/vip-privileges" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.USERS}><VipPrivilegePage /></AdminRouteGuard>} />
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
                    <Route path="/admin/weekly-leaderboards" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.REWARDS}><WeeklyLeaderboardRewardPage /></AdminRouteGuard>} />
                    <Route path="/admin/auctions" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.AUCTIONS}><AuctionManagementPage /></AdminRouteGuard>} />
                    <Route path="/admin/promo-codes" element={<AdminRouteGuard permission={ADMIN_PERMISSIONS.CODES}><PromoCodeManagerPage /></AdminRouteGuard>} />
                </Route>
            </Routes>
        </Suspense>
    )
}
