import UserPokemon from '../models/UserPokemon.js'
import { normalizeFormId } from '../utils/pokemonFormStats.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

export const hasOwnedPokemonForm = async (userId, pokemonId, formId = 'normal') => {
    const normalizedPokemonId = String(pokemonId || '').trim()
    if (!normalizedPokemonId) return false

    const ownedEntries = await UserPokemon.find(withActiveUserPokemonFilter({ userId, pokemonId: normalizedPokemonId }))
        .select('formId')
        .lean()

    const normalizedTargetFormId = normalizeFormId(formId)
    return ownedEntries.some((entry) => normalizeFormId(entry?.formId || 'normal') === normalizedTargetFormId)
}
