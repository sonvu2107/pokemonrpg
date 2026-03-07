import { useQuery } from '@tanstack/react-query'
import { gameApi } from '../../services/gameApi'

export const gameQueryKeys = {
    profile: ['profile'],
    inventory: ['inventory'],
    maps: ['maps'],
    battleTrainers: ['battleTrainers'],
}

export const profileQueryOptions = () => ({
    queryKey: gameQueryKeys.profile,
    queryFn: () => gameApi.getProfile(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
})

export const inventoryQueryOptions = () => ({
    queryKey: gameQueryKeys.inventory,
    queryFn: () => gameApi.getInventory(),
    staleTime: 10_000,
    gcTime: 2 * 60_000,
    refetchOnWindowFocus: false,
})

export const mapsQueryOptions = () => ({
    queryKey: gameQueryKeys.maps,
    queryFn: () => gameApi.getMaps(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
})

export const battleTrainersQueryOptions = () => ({
    queryKey: gameQueryKeys.battleTrainers,
    queryFn: () => gameApi.getBattleTrainers(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
})

export const useProfileQuery = (options = {}) => {
    return useQuery({
        ...profileQueryOptions(),
        ...options,
    })
}

export const useInventoryQuery = (options = {}) => {
    return useQuery({
        ...inventoryQueryOptions(),
        ...options,
    })
}

export const useMapsQuery = (options = {}) => {
    return useQuery({
        ...mapsQueryOptions(),
        ...options,
    })
}
