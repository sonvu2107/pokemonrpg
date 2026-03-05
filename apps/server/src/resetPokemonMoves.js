import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import UserPokemon from './models/UserPokemon.js'
import Pokemon from './models/Pokemon.js'
import { buildMovesForLevel, normalizeMoveName } from './utils/movePpUtils.js'

void Pokemon

dotenv.config()

const args = process.argv.slice(2)

const hasFlag = (flag) => args.includes(flag)

const getArgValue = (flag) => {
    const index = args.indexOf(flag)
    if (index < 0) return ''
    return String(args[index + 1] || '').trim()
}

const toExplicitMoveList = (moves = []) => (Array.isArray(moves) ? moves : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 4)

const moveListsEqual = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (normalizeMoveName(left[index]) !== normalizeMoveName(right[index])) {
            return false
        }
    }
    return true
}

const parseObjectIdArg = (flag) => {
    const raw = getArgValue(flag)
    if (!raw) return null
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new Error(`Giá trị ${flag} không hợp lệ: ${raw}`)
    }
    return new mongoose.Types.ObjectId(raw)
}

const parseDateArg = (flag) => {
    const raw = getArgValue(flag)
    if (!raw) return null
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Giá trị ${flag} không hợp lệ: ${raw}`)
    }
    return parsed
}

const mode = String(getArgValue('--mode') || 'level-up-only').trim().toLowerCase()
const supportedModes = new Set(['all', 'level-up-only'])

const shouldApply = hasFlag('--apply')
const isDryRun = !shouldApply
const userIdFilter = parseObjectIdArg('--user-id')
const pokemonInstanceFilter = parseObjectIdArg('--pokemon-id')
const afterFilter = parseDateArg('--after')
const beforeFilter = parseDateArg('--before')

if (!supportedModes.has(mode)) {
    throw new Error(`Mode không hợp lệ: ${mode}. Hỗ trợ: all, level-up-only`)
}

const run = async () => {
    try {
        await connectDB()

        const query = {}
        if (userIdFilter) {
            query.userId = userIdFilter
        }
        if (pokemonInstanceFilter) {
            query._id = pokemonInstanceFilter
        }
        if (afterFilter || beforeFilter) {
            query.obtainedAt = {}
            if (afterFilter) {
                query.obtainedAt.$gte = afterFilter
            }
            if (beforeFilter) {
                query.obtainedAt.$lte = beforeFilter
            }
        }

        const totalMatched = await UserPokemon.countDocuments(query)

        console.log('=== Reset Pokemon Moves ===')
        console.log(`Mode: ${mode}`)
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Matched by filter: ${totalMatched}`)
        if (userIdFilter) {
            console.log(`Filter userId: ${String(userIdFilter)}`)
        }
        if (pokemonInstanceFilter) {
            console.log(`Filter pokemonId: ${String(pokemonInstanceFilter)}`)
        }
        if (afterFilter) {
            console.log(`Filter obtainedAt >= ${afterFilter.toISOString()}`)
        }
        if (beforeFilter) {
            console.log(`Filter obtainedAt <= ${beforeFilter.toISOString()}`)
        }

        if (totalMatched === 0) {
            console.log('Không có Pokemon nào khớp bộ lọc.')
            return
        }

        const cursor = UserPokemon.find(query)
            .select('_id userId pokemonId level moves movePpState obtainedAt')
            .populate('pokemonId', 'name levelUpMoves')
            .cursor()

        let scanned = 0
        let hasMoves = 0
        let resetCandidates = 0
        let skippedByMode = 0
        let applied = 0

        const preview = []

        for await (const entry of cursor) {
            scanned += 1

            const explicitMoves = toExplicitMoveList(entry.moves)
            if (explicitMoves.length === 0) {
                continue
            }
            hasMoves += 1

            let shouldResetEntry = false
            let reason = 'all'

            if (mode === 'all') {
                shouldResetEntry = true
            } else {
                const expectedLevelMoves = buildMovesForLevel(entry.pokemonId, Number(entry.level) || 1)
                shouldResetEntry = expectedLevelMoves.length > 0 && moveListsEqual(explicitMoves, expectedLevelMoves)
                reason = 'matches_level_up_defaults'
            }

            if (!shouldResetEntry) {
                skippedByMode += 1
                continue
            }

            resetCandidates += 1
            if (preview.length < 20) {
                preview.push({
                    userPokemonId: String(entry._id),
                    species: String(entry?.pokemonId?.name || '').trim() || 'Unknown',
                    level: Number(entry.level) || 1,
                    moves: explicitMoves,
                    reason,
                })
            }

            if (!isDryRun) {
                const result = await UserPokemon.updateOne(
                    { _id: entry._id },
                    {
                        $set: {
                            moves: [],
                            movePpState: [],
                        },
                    }
                )
                applied += Number(result.modifiedCount || 0)
            }
        }

        console.log(`Scanned: ${scanned}`)
        console.log(`Has explicit moves: ${hasMoves}`)
        console.log(`Candidates to reset: ${resetCandidates}`)
        console.log(`Skipped by mode: ${skippedByMode}`)
        console.log(`Applied: ${applied}`)
        console.log('Preview (max 20):')
        console.log(JSON.stringify(preview, null, 2))

        if (isDryRun) {
            console.log('Dry run hoàn tất. Chưa có dữ liệu nào bị thay đổi.')
            console.log('Dùng --apply để áp dụng thật.')
        }
    } catch (error) {
        console.error('Reset failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
