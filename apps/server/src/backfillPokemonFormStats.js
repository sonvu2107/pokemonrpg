import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import Pokemon from './models/Pokemon.js'
import {
    hasMeaningfulPokemonBaseStats,
    mergePokemonBaseStatsWithFallback,
    normalizeFormId,
    normalizePokemonBaseStats,
    toStorageFormStats,
} from './utils/pokemonFormStats.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)
const shouldApply = argsSet.has('--apply')
const isDryRun = !shouldApply

const previewLimitArgIndex = args.indexOf('--preview-limit')
const previewLimitRaw = previewLimitArgIndex >= 0
    ? Number.parseInt(args[previewLimitArgIndex + 1], 10)
    : 30
const previewLimit = Number.isInteger(previewLimitRaw) && previewLimitRaw > 0
    ? Math.min(previewLimitRaw, 200)
    : 30

const STAT_KEYS = ['hp', 'atk', 'def', 'spatk', 'spdef', 'spd']

const run = async () => {
    try {
        await connectDB()

        const speciesRows = await Pokemon.find({ 'forms.0': { $exists: true } })
            .select('_id name baseStats forms')
            .lean()

        const bulkOperations = []
        const preview = []

        let totalSpeciesWithForms = 0
        let totalForms = 0
        let speciesToUpdate = 0
        let formsToUpdate = 0
        let allZeroFormsToUpdate = 0
        let partialFormsToUpdate = 0

        for (const species of speciesRows) {
            const forms = Array.isArray(species?.forms) ? species.forms : []
            if (forms.length === 0) continue

            totalSpeciesWithForms += 1
            totalForms += forms.length

            const fallbackStats = normalizePokemonBaseStats(species?.baseStats || {})
            if (!hasMeaningfulPokemonBaseStats(fallbackStats)) {
                continue
            }

            let touched = false
            const nextForms = forms.map((formEntry) => {
                const currentStats = normalizePokemonBaseStats(formEntry?.stats || {})
                const mergedStats = mergePokemonBaseStatsWithFallback(currentStats, fallbackStats)
                const changedKeys = STAT_KEYS.filter((key) => mergedStats[key] !== currentStats[key])

                if (changedKeys.length === 0) {
                    return formEntry
                }

                touched = true
                formsToUpdate += 1

                const isAllZero = !hasMeaningfulPokemonBaseStats(currentStats)
                if (isAllZero) {
                    allZeroFormsToUpdate += 1
                } else {
                    partialFormsToUpdate += 1
                }

                if (preview.length < previewLimit) {
                    preview.push({
                        speciesId: String(species?._id || ''),
                        speciesName: String(species?.name || '').trim() || 'Unknown',
                        formId: normalizeFormId(formEntry?.formId || 'normal'),
                        changedKeys,
                        before: toStorageFormStats(currentStats),
                        after: toStorageFormStats(mergedStats),
                    })
                }

                return {
                    ...formEntry,
                    stats: toStorageFormStats(mergedStats),
                }
            })

            if (!touched) {
                continue
            }

            speciesToUpdate += 1
            bulkOperations.push({
                updateOne: {
                    filter: { _id: species._id },
                    update: {
                        $set: {
                            forms: nextForms,
                            updatedAt: new Date(),
                        },
                    },
                },
            })
        }

        console.log('=== Pokemon Form Stats Backfill ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Species with forms: ${totalSpeciesWithForms}`)
        console.log(`Total forms scanned: ${totalForms}`)
        console.log(`Species to update: ${speciesToUpdate}`)
        console.log(`Forms to update: ${formsToUpdate}`)
        console.log(`All-zero forms to update: ${allZeroFormsToUpdate}`)
        console.log(`Partial forms to update: ${partialFormsToUpdate}`)
        console.log(`Preview sample size: ${preview.length}`)
        if (preview.length > 0) {
            console.log(JSON.stringify(preview, null, 2))
        }

        if (bulkOperations.length === 0) {
            console.log('No form stats need updates.')
            return
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to persist form stat backfill updates.')
            return
        }

        const result = await Pokemon.bulkWrite(bulkOperations, { ordered: false })
        console.log('Backfill complete.')
        console.log(`Matched species: ${result.matchedCount || 0}`)
        console.log(`Modified species: ${result.modifiedCount || 0}`)
    } catch (error) {
        console.error('Backfill failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
