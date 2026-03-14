import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import BattleTrainer from '../models/BattleTrainer.js'

dotenv.config()

const SNAPSHOT_COLLECTION = 'maintenance_snapshots'
const SNAPSHOT_TYPE = 'battle-trainer-team-levels'

const args = process.argv.slice(2)
const argSet = new Set(args)

const isDryRun = argSet.has('--dry-run')
const strictTeamSize = argSet.has('--strict-team-size')

const parseArgValue = (name, fallback = '') => {
    const prefix = `--${name}=`
    const raw = args.find((entry) => String(entry || '').startsWith(prefix))
    if (!raw) return fallback
    return String(raw.slice(prefix.length) || '').trim()
}

const snapshotTag = parseArgValue('tag', '')

const run = async () => {
    try {
        await connectDB()

        const snapshotCollection = mongoose.connection.collection(SNAPSHOT_COLLECTION)
        const snapshotQuery = snapshotTag
            ? { type: SNAPSHOT_TYPE, tag: snapshotTag }
            : { type: SNAPSHOT_TYPE }

        const snapshot = await snapshotCollection
            .find(snapshotQuery)
            .sort({ createdAt: -1 })
            .limit(1)
            .next()

        if (!snapshot) {
            throw new Error(snapshotTag
                ? `Snapshot not found for tag: ${snapshotTag}`
                : 'No snapshot found. Create one first.')
        }

        const rows = Array.isArray(snapshot?.trainers) ? snapshot.trainers : []
        const trainerIds = rows
            .map((row) => String(row?.trainerId || '').trim())
            .filter(Boolean)

        const trainers = await BattleTrainer.find({ _id: { $in: trainerIds } })
            .select('_id name team')
            .lean()

        const trainerById = new Map(
            trainers.map((entry) => [String(entry?._id || '').trim(), entry])
        )

        let missingTrainerCount = 0
        let skippedStrictCount = 0
        let changedTrainerCount = 0
        let changedTeamEntryCount = 0
        const previewRows = []
        const bulkOps = []

        for (const row of rows) {
            const trainerId = String(row?.trainerId || '').trim()
            if (!trainerId) continue

            const trainer = trainerById.get(trainerId)
            if (!trainer) {
                missingTrainerCount += 1
                continue
            }

            const currentTeam = Array.isArray(trainer?.team) ? trainer.team : []
            const snapshotLevels = Array.isArray(row?.teamLevels) ? row.teamLevels : []
            const snapshotTeam = Array.isArray(row?.team)
                ? row.team
                    .map((entry) => ({
                        pokemonId: String(entry?.pokemonId || '').trim(),
                        level: Math.max(1, Number.parseInt(entry?.level, 10) || 1),
                        formId: String(entry?.formId || 'normal').trim().toLowerCase() || 'normal',
                        damagePercent: Math.max(0, Number.parseInt(entry?.damagePercent, 10) || 100),
                    }))
                    .filter((entry) => entry.pokemonId)
                : []

            const snapshotSize = snapshotTeam.length > 0 ? snapshotTeam.length : snapshotLevels.length
            if (strictTeamSize && currentTeam.length !== snapshotSize) {
                skippedStrictCount += 1
                continue
            }

            let changedSlots = 0
            let nextTeam = []

            if (snapshotTeam.length > 0) {
                nextTeam = snapshotTeam.map((snapshotEntry, index) => {
                    const currentEntry = currentTeam[index] || {}
                    const currentPokemonId = String(currentEntry?.pokemonId || '').trim()
                    const currentLevel = Math.max(1, Number.parseInt(currentEntry?.level, 10) || 1)
                    const currentFormId = String(currentEntry?.formId || 'normal').trim().toLowerCase() || 'normal'
                    const currentDamagePercent = Math.max(0, Number.parseInt(currentEntry?.damagePercent, 10) || 100)

                    if (
                        currentPokemonId !== snapshotEntry.pokemonId
                        || currentLevel !== snapshotEntry.level
                        || currentFormId !== snapshotEntry.formId
                        || currentDamagePercent !== snapshotEntry.damagePercent
                    ) {
                        changedSlots += 1
                    }

                    return {
                        ...currentEntry,
                        pokemonId: snapshotEntry.pokemonId,
                        level: snapshotEntry.level,
                        formId: snapshotEntry.formId,
                        damagePercent: snapshotEntry.damagePercent,
                    }
                })
            } else {
                const slotCount = Math.min(currentTeam.length, snapshotLevels.length)
                nextTeam = currentTeam.map((entry, index) => {
                    if (index >= slotCount) return entry

                    const snapshotLevel = Math.max(1, Number.parseInt(snapshotLevels[index], 10) || 1)
                    const currentLevel = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
                    if (snapshotLevel === currentLevel) return entry

                    changedSlots += 1
                    return {
                        ...entry,
                        level: snapshotLevel,
                    }
                })
            }

            if (changedSlots === 0) continue

            changedTrainerCount += 1
            changedTeamEntryCount += changedSlots

            if (previewRows.length < 10) {
                previewRows.push({
                    trainerId,
                    name: String(trainer?.name || '').trim() || 'Trainer',
                    changedSlots,
                })
            }

            bulkOps.push({
                updateOne: {
                    filter: { _id: trainer._id },
                    update: {
                        $set: {
                            team: nextTeam,
                        },
                    },
                },
            })
        }

        console.log('=== Rollback Trainer Team Levels Snapshot ===')
        console.log(`Tag: ${snapshot.tag}`)
        console.log(`Created at: ${snapshot.createdAt}`)
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Strict team size: ${strictTeamSize ? 'yes' : 'no'}`)
        console.log(`Snapshot trainers: ${rows.length}`)
        console.log(`Found trainers: ${trainers.length}`)
        console.log(`Missing trainers: ${missingTrainerCount}`)
        console.log(`Skipped (size mismatch): ${skippedStrictCount}`)
        console.log(`Trainers to rollback: ${changedTrainerCount}`)
        console.log(`Team entries to rollback: ${changedTeamEntryCount}`)

        if (previewRows.length > 0) {
            console.log('Preview (first 10):')
            previewRows.forEach((row, index) => {
                console.log(
                    `${index + 1}. ${row.name} (${row.trainerId}) | slots: ${row.changedSlots}`
                )
            })
        }

        if (isDryRun || bulkOps.length === 0) {
            console.log(isDryRun ? 'Dry run complete. No data was modified.' : 'No updates needed.')
            return
        }

        const bulkResult = await BattleTrainer.bulkWrite(bulkOps, { ordered: false })
        console.log('Rollback complete.')
        console.log(`Bulk matched: ${bulkResult.matchedCount || 0}`)
        console.log(`Bulk modified: ${bulkResult.modifiedCount || 0}`)
    } catch (error) {
        console.error('Rollback failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
