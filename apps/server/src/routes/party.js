import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'
import { buildMoveLookupByName, buildMovePpStateFromMoves, mergeKnownMovesWithFallback, normalizeMoveName } from '../utils/movePpUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { enforcePartyUniqueSpeciesForUser } from '../utils/partyDuplicateUtils.js'

const router = express.Router()

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolveFormStats = (species = {}, formId = null) => {
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
    return resolvedForm?.stats || species?.baseStats || {}
}

const serializePartyPokemon = ({ entry, moveLookupMap }) => {
    if (!entry) return null

    const base = entry.pokemonId || {}
    const stats = calcStatsForLevel(resolveFormStats(base, entry.formId), entry.level, base.rarity)
    const plainEntry = entry.toObject()
    plainEntry.stats = stats

    const mergedMoveNames = mergeKnownMovesWithFallback(plainEntry.moves)
    const movePpState = buildMovePpStateFromMoves({
        moveNames: mergedMoveNames,
        movePpState: plainEntry.movePpState,
        moveLookupMap,
    })

    plainEntry.moves = movePpState.map((moveEntry) => ({
        ...(moveLookupMap.get(normalizeMoveName(moveEntry.moveName)) || {}),
        name: moveEntry.moveName,
        currentPp: moveEntry.currentPp,
        maxPp: moveEntry.maxPp,
        pp: moveEntry.currentPp,
    }))
    plainEntry.movePpState = movePpState

    return plainEntry
}

router.use(authMiddleware)

// GET /api/party
// Return list of 6 slots found in party
router.get('/', async (req, res) => {
    try {
        await enforcePartyUniqueSpeciesForUser(req.user.userId)

        const party = await UserPokemon.find(withActiveUserPokemonFilter({
            userId: req.user.userId,
            location: 'party',
        }))
            .populate('pokemonId')
            .sort({ partyIndex: 1 })

        const allMoveNames = party
            .map((entry) => mergeKnownMovesWithFallback(entry.moves))
            .flat()
        const moveLookupMap = await buildMoveLookupByName(allMoveNames)

        // Ensure we always return 6 slots, even if empty
        const slots = Array(6).fill(null)
        party.forEach((entry) => {
            const payload = serializePartyPokemon({ entry, moveLookupMap })
            if (!payload) return

            const requestedSlotIndex = Number(entry?.partyIndex)
            if (
                Number.isInteger(requestedSlotIndex)
                && requestedSlotIndex >= 0
                && requestedSlotIndex < slots.length
                && !slots[requestedSlotIndex]
            ) {
                slots[requestedSlotIndex] = payload
                return
            }

            // Handle duplicate/invalid indexes by placing into next available slot.
            const firstEmpty = slots.findIndex((slot) => slot === null)
            if (firstEmpty !== -1) {
                slots[firstEmpty] = payload
            }
        })

        res.json({ ok: true, party: slots })
    } catch (error) {
        console.error('Get Party Error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/party/swap
// Body: { fromIndex: number, toIndex: number }
router.post('/swap', async (req, res) => {
    try {
        const { fromIndex, toIndex } = req.body
        const userId = req.user.userId

        await enforcePartyUniqueSpeciesForUser(userId)

        if (fromIndex === undefined || toIndex === undefined) {
            return res.status(400).json({ ok: false, message: 'Cần cung cấp vị trí đổi' })
        }
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            return res.status(400).json({ ok: false, message: 'Vị trí đổi phải là số nguyên' })
        }
        if (fromIndex < 0 || fromIndex > 5 || toIndex < 0 || toIndex > 5) {
            return res.status(400).json({ ok: false, message: 'Vị trí đổi phải trong khoảng 0-5' })
        }
        if (fromIndex === toIndex) {
            return res.json({ ok: true, message: 'Không có thay đổi' })
        }

        // Find pokes at these indices
        const p1 = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId, location: 'party', partyIndex: fromIndex }))
        const p2 = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId, location: 'party', partyIndex: toIndex }))

        if (!p1) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon ở ô nguồn' })
        }

        // Swap indices
        p1.partyIndex = toIndex
        await p1.save()

        if (p2) {
            p2.partyIndex = fromIndex
            await p2.save()
        }

        res.json({ ok: true, message: 'Đã đổi vị trí' })

    } catch (error) {
        console.error('Swap Party Error:', error)
        res.status(500).json({ ok: false, message: 'Đổi vị trí thất bại' })
    }
})

// POST /api/party/add
// Body: { pokemonId: string, slotIndex: number (optional) }
router.post('/add', async (req, res) => {
    try {
        const { pokemonId, slotIndex } = req.body
        const userId = req.user.userId

        await enforcePartyUniqueSpeciesForUser(userId)

        const pokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: pokemonId, userId }))
        if (!pokemon) return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })

        if (pokemon.location === 'party') {
            return res.status(400).json({ ok: false, message: 'Pokemon đã ở trong đội hình' })
        }

        // Count current party size
        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
        if (party.length >= 6) {
            return res.status(400).json({ ok: false, message: 'Đội hình đã đầy' })
        }

        const targetSpeciesId = String(pokemon?.pokemonId || '').trim()
        const duplicateSpeciesInParty = party.some((entry) => String(entry?.pokemonId || '').trim() === targetSpeciesId)
        if (duplicateSpeciesInParty) {
            return res.status(400).json({ ok: false, message: 'Không thể thêm 2 Pokemon trùng loài trong cùng đội hình' })
        }

        // Determine index
        let targetIndex = slotIndex
        if (targetIndex === undefined || targetIndex === null) {
            // Find first empty slot
            const occupied = new Set(party.map(p => p.partyIndex))
            for (let i = 0; i < 6; i++) {
                if (!occupied.has(i)) {
                    targetIndex = i
                    break
                }
            }
        } else {
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 5) {
                return res.status(400).json({ ok: false, message: 'slotIndex phải trong khoảng 0-5' })
            }
            const occupied = party.some(p => p.partyIndex === targetIndex)
            if (occupied) {
                return res.status(400).json({ ok: false, message: 'Ô đích đã có Pokemon' })
            }
        }

        // Move to party
        pokemon.location = 'party'
        pokemon.partyIndex = targetIndex
        pokemon.boxNumber = null
        await pokemon.save()

        res.json({ ok: true, message: 'Đã thêm vào đội hình' })

    } catch (error) {
        console.error('Add Party Error:', error)
        res.status(500).json({ ok: false, message: 'Thêm vào đội hình thất bại' })
    }
})

// POST /api/party/remove
// Body: { pokemonId: string }
router.post('/remove', async (req, res) => {
    try {
        const { pokemonId } = req.body
        const userId = req.user.userId

        const pokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: pokemonId, userId, location: 'party' }))
        if (!pokemon) return res.status(404).json({ ok: false, message: 'Pokemon không có trong đội hình' })

        // Move to box
        pokemon.location = 'box'
        pokemon.partyIndex = null
        pokemon.boxNumber = 1 // Default box 1 for now
        await pokemon.save()

        res.json({ ok: true, message: 'Đã đưa ra khỏi đội hình' })

    } catch (error) {
        console.error('Remove Party Error:', error)
        res.status(500).json({ ok: false, message: 'Xóa khỏi đội hình thất bại' })
    }
})


export default router
