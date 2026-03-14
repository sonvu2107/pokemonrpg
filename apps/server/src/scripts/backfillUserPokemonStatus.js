/**
 * backfillUserPokemonStatus.js
 *
 * One-time migration: set status = 'active' on every UserPokemon document
 * that was created before the `status` field was added to the schema.
 *
 * Usage (dry-run first, then apply):
 *   node --experimental-vm-modules src/scripts/backfillUserPokemonStatus.js
 *   node --experimental-vm-modules src/scripts/backfillUserPokemonStatus.js --apply
 */

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import UserPokemon from '../models/UserPokemon.js'

dotenv.config()

const args = process.argv.slice(2)
const shouldApply = args.includes('--apply')
const isDryRun = !shouldApply

const run = async () => {
    try {
        await connectDB()

        console.log('=== Backfill UserPokemon.status ===')
        console.log(`Dry run: ${isDryRun ? 'yes (pass --apply to write)' : 'NO — writing to DB'}`)

        // Count documents without the field
        const missingCount = await UserPokemon.countDocuments({ status: { $exists: false } })
        console.log(`Documents missing status field: ${missingCount}`)

        if (missingCount === 0) {
            console.log('Nothing to do — all documents already have status set.')
            return
        }

        if (isDryRun) {
            // Sample a few to show what would change
            const samples = await UserPokemon.find({ status: { $exists: false } })
                .select('_id userId pokemonId location createdAt')
                .limit(5)
                .lean()
            console.log('Sample documents that will be updated (max 5):')
            console.log(JSON.stringify(samples, null, 2))
            console.log(`\nDry run complete. Run with --apply to update ${missingCount} document(s).`)
            return
        }

        // Apply — updateMany is atomic per-document at MongoDB level; safe without transactions
        const result = await UserPokemon.updateMany(
            { status: { $exists: false } },
            { $set: { status: 'active' } }
        )

        console.log(`Modified: ${result.modifiedCount} / ${missingCount} documents`)
        console.log('Backfill complete.')
    } catch (err) {
        console.error('Backfill failed:', err.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
