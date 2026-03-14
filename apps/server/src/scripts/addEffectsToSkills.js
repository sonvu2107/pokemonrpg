import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Move from '../models/Move.js'
import { getDefaultEffectSpecForOp } from '../battle/effects/effectMeta.js'

dotenv.config({ path: '.env' })

const normalize = (value = '') => String(value || '').trim()
const normalizeLower = (value = '') => normalize(value).toLowerCase()

const parseArgs = () => {
    const raw = process.argv.slice(2)
    const args = {
        file: '',
        apply: false,
        replace: true,
    }

    for (let index = 0; index < raw.length; index += 1) {
        const token = String(raw[index] || '').trim()
        if (!token) continue
        if (token === '--apply') {
            args.apply = true
            continue
        }
        if (token === '--append') {
            args.replace = false
            continue
        }
        if (token === '--replace') {
            args.replace = true
            continue
        }
        if (token === '--file') {
            args.file = String(raw[index + 1] || '').trim()
            index += 1
            continue
        }
    }

    return args
}

const normalizeEffectSpecsInput = (effectSpecs = []) => {
    if (!Array.isArray(effectSpecs)) return []
    return effectSpecs
        .map((entry) => {
            const op = String(entry?.op || '').trim().toLowerCase()
            if (!op) return null
            const trigger = String(entry?.trigger || 'on_hit').trim() || 'on_hit'
            const target = String(entry?.target || 'opponent').trim() || 'opponent'
            const chanceRaw = Number(entry?.chance)
            const chance = Number.isFinite(chanceRaw)
                ? Math.max(0, Math.min(1, chanceRaw))
                : 1

            return {
                op,
                trigger,
                target,
                chance,
                params: entry?.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
                    ? entry.params
                    : {},
                sourceText: String(entry?.sourceText || '').trim(),
                parserConfidence: Number.isFinite(Number(entry?.parserConfidence))
                    ? Math.max(0, Math.min(1, Number(entry.parserConfidence)))
                    : 1,
            }
        })
        .filter(Boolean)
}

const buildSpecsFromEntry = (entry = {}) => {
    const explicitSpecs = normalizeEffectSpecsInput(entry?.effectSpecs)
    if (explicitSpecs.length > 0) return explicitSpecs

    const effectIds = Array.isArray(entry?.effectIds) ? entry.effectIds : []
    const specsFromIds = effectIds
        .map((effectId) => {
            const op = String(effectId || '').trim().toLowerCase()
            if (!op) return null
            return getDefaultEffectSpecForOp(op)
        })
        .filter(Boolean)
    return normalizeEffectSpecsInput(specsFromIds)
}

const uniqueSpecs = (specs = []) => {
    const seen = new Set()
    const output = []
    specs.forEach((entry) => {
        const key = JSON.stringify({
            op: entry.op,
            trigger: entry.trigger,
            target: entry.target,
            chance: entry.chance,
            params: entry.params,
        })
        if (seen.has(key)) return
        seen.add(key)
        output.push(entry)
    })
    return output
}

const loadPayloadEntries = async (filePath) => {
    const absolutePath = path.resolve(process.cwd(), filePath)
    const rawContent = await fs.readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(rawContent)
    const entries = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.moves) ? parsed.moves : [])
    return {
        absolutePath,
        entries,
    }
}

const buildPreview = (entries = [], replace = true) => {
    const warnings = []
    const normalizedEntries = entries
        .map((entry, index) => {
            const moveName = normalize(entry?.move || entry?.name)
            if (!moveName) {
                warnings.push(`Dòng ${index + 1}: thiếu move/name`)
                return null
            }

            const effectSpecs = buildSpecsFromEntry(entry)
            if (effectSpecs.length === 0) {
                warnings.push(`Dòng ${index + 1} (${moveName}): không có effectSpecs/effectIds hợp lệ`)
                return null
            }

            return {
                moveName,
                moveNameLower: normalizeLower(moveName),
                effectSpecs,
                replace,
            }
        })
        .filter(Boolean)

    const dedupedByName = new Map()
    normalizedEntries.forEach((entry) => {
        dedupedByName.set(entry.moveNameLower, entry)
    })

    return {
        entries: [...dedupedByName.values()],
        warnings,
    }
}

const applyEntries = async (entries = [], { replace = true } = {}) => {
    if (!process.env.MONGO_URI) {
        throw new Error('Missing MONGO_URI environment variable')
    }

    await mongoose.connect(process.env.MONGO_URI)
    try {
        const result = {
            matchedMoves: 0,
            updatedMoves: 0,
            missingMoves: [],
            skippedNoChange: 0,
        }

        for (const entry of entries) {
            const move = await Move.findOne({ nameLower: entry.moveNameLower })
            if (!move) {
                result.missingMoves.push(entry.moveName)
                continue
            }

            result.matchedMoves += 1

            const currentSpecs = normalizeEffectSpecsInput(move.effectSpecs || [])
            const nextSpecs = replace
                ? uniqueSpecs(entry.effectSpecs)
                : uniqueSpecs([...currentSpecs, ...entry.effectSpecs])

            const currentKey = JSON.stringify(currentSpecs)
            const nextKey = JSON.stringify(nextSpecs)
            if (currentKey === nextKey) {
                result.skippedNoChange += 1
                continue
            }

            move.effectSpecs = nextSpecs
            move.effects = {
                ...(move.effects && typeof move.effects === 'object' ? move.effects : {}),
                manualEffectSpecUpdatedAt: new Date().toISOString(),
            }
            await move.save()
            result.updatedMoves += 1
        }

        return result
    } finally {
        await mongoose.disconnect()
    }
}

async function main() {
    const args = parseArgs()
    if (!args.file) {
        throw new Error('Thiếu --file <path_to_json>. Ví dụ: node src/scripts/addEffectsToSkills.js --file ../../data/move-effects.manual.json --apply')
    }

    const loaded = await loadPayloadEntries(args.file)
    const preview = buildPreview(loaded.entries, args.replace)

    if (!args.apply) {
        console.log(JSON.stringify({
            ok: true,
            mode: 'dry-run',
            filePath: loaded.absolutePath,
            replace: args.replace,
            totalEntriesInFile: loaded.entries.length,
            validEntries: preview.entries.length,
            warnings: preview.warnings,
            sample: preview.entries.slice(0, 10).map((entry) => ({
                moveName: entry.moveName,
                effectSpecs: entry.effectSpecs,
            })),
        }, null, 2))
        return
    }

    const applyResult = await applyEntries(preview.entries, { replace: args.replace })
    console.log(JSON.stringify({
        ok: true,
        mode: 'apply',
        filePath: loaded.absolutePath,
        replace: args.replace,
        totalEntriesInFile: loaded.entries.length,
        validEntries: preview.entries.length,
        warnings: preview.warnings,
        applyResult: {
            ...applyResult,
            missingMovesCount: applyResult.missingMoves.length,
            sampleMissingMoves: applyResult.missingMoves.slice(0, 30),
        },
    }, null, 2))
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
    process.exitCode = 1
})
