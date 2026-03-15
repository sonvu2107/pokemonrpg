import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectDB } from '../config/db.js'

dotenv.config({ path: '.env' })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const modelsDir = path.resolve(__dirname, '../models')
const TARGET_MODELS = [
    'User',
    'UserMoveInventory',
    'UserPokemon',
    'WeeklyLeaderboardReward',
]

const loadModelFiles = async () => {
    const entries = await fs.readdir(modelsDir, { withFileTypes: true })
    const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => path.join(modelsDir, entry.name))
        .sort((left, right) => left.localeCompare(right))

    for (const filePath of files) {
        await import(pathToFileURL(filePath).href)
    }
}

async function main() {
    await connectDB()
    await loadModelFiles()

    const results = []

    for (const modelName of TARGET_MODELS) {
        if (!mongoose.modelNames().includes(modelName)) {
            results.push({
                model: modelName,
                ensured: false,
                reason: 'MODEL_NOT_REGISTERED',
            })
            continue
        }

        const model = mongoose.model(modelName)
        await model.createIndexes()
        const indexes = await model.collection.indexes()

        results.push({
            model: modelName,
            ensured: true,
            totalIndexes: Array.isArray(indexes) ? indexes.length : 0,
        })
    }

    console.log(JSON.stringify({
        ok: true,
        modelsEnsured: results.length,
        results,
    }, null, 2))
}

main()
    .catch((error) => {
        console.error(JSON.stringify({
            ok: false,
            error: String(error?.message || error),
        }, null, 2))
        process.exitCode = 1
    })
    .finally(async () => {
        try {
            await mongoose.disconnect()
        } catch {
            // Ignore disconnect cleanup failures.
        }
    })
