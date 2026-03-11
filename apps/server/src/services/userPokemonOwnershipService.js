import { hasUserPokedexEntry } from './userPokedexService.js'

export const hasOwnedPokemonForm = async (userId, pokemonId, formId = 'normal') => {
    return hasUserPokedexEntry(userId, pokemonId, formId)
}
