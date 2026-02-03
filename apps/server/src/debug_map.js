import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '../.env') })

// Import models
import Map from './models/Map.js'
import DropRate from './models/DropRate.js'
import Pokemon from './models/Pokemon.js'

async function debugMapData() {
    try {
        await mongoose.connect(process.env.MONGO_URI)
        console.log('Connected to DB')

        // 1. Find the Map "Rừng già"
        // Try searching by name regex
        const map = await Map.findOne({ name: /Rừng già/i })

        if (!map) {
            console.log('Map "Rừng già" not found. Listing all maps:')
            const maps = await Map.find({}, 'name slug')
            console.log(maps)
            return
        }

        console.log(`Found Map: ${map.name} (Slug: ${map.slug}, ID: ${map._id})`)

        // 2. Find Drop Rates
        const dropRates = await DropRate.find({ mapId: map._id }).populate('pokemonId')

        console.log(`Found ${dropRates.length} drop rates:`)

        dropRates.forEach(dr => {
            if (!dr.pokemonId) {
                console.log(`- DropRate ID: ${dr._id} has NO Pokemon linked! (Broken)`)
            } else {
                console.log(`- Pokemon: ${dr.pokemonId.name}`)
                console.log(`  > Rarity: '${dr.pokemonId.rarity}'`) // Quote to see whitespace or empty
                console.log(`  > Pokedex: ${dr.pokemonId.pokedexNumber}`)
                console.log(`  > Weight: ${dr.weight}`)
            }
        })

    } catch (err) {
        console.error(err)
    } finally {
        await mongoose.disconnect()
    }
}

debugMapData()
