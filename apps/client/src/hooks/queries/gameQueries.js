import { useQuery } from '@tanstack/react-query'
import { gameApi } from '../../services/gameApi'

export const gameQueryKeys = {
    profile: ['profile'],
    profileLight: ['profile', 'light'],
    inventory: ['inventory'],
    maps: ['maps'],
    battleTrainers: ['battleTrainers', 'summary'],
    battleTrainerDetail: (trainerId) => ['battleTrainers', 'detail', String(trainerId || '').trim()],
}

export const profileQueryOptions = () => ({
    queryKey: gameQueryKeys.profile,
    queryFn: () => gameApi.getProfile(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
})

export const profileLightQueryOptions = () => ({
    queryKey: gameQueryKeys.profileLight,
    queryFn: () => gameApi.getProfile({ light: true }),
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
    queryFn: () => gameApi.getBattleTrainers({ view: 'summary' }),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
})

export const battleTrainerDetailQueryOptions = (trainerId) => ({
    queryKey: gameQueryKeys.battleTrainerDetail(trainerId),
    queryFn: () => gameApi.getBattleTrainer(trainerId),
    staleTime: 5 * 60_000,
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
