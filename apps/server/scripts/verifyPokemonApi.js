
import fetch from 'node-fetch'

const API_URL = 'http://localhost:3000/api'

// Need a valid Pokemon ID. I'll try to fetch the box first to get one.
// Assuming verify-script runs in a context where I login? Or I can just try to find a public endpoint?
// The box endpoint is protected.
// But wait, the pokemon info endpoint is PUBLIC (no authMiddleware in pokemon.js).
// So I just need a valid ID. I'll try to look at database or use a shell script.

// Better approach: I'll use a script that connects to DB, gets a user pokemon ID, then calls the API.

import mongoose from 'mongoose'
import UserPokemon from '../src/models/UserPokemon.js'
import Pokemon from '../src/models/Pokemon.js'

// Mock environment
process.env.MONGODB_URI = 'mongodb://localhost:27017/pokemon' // Adjust if needed

async function verify() {
    try {
        await mongoose.connect(process.env.MONGODB_URI)
        console.log('Connected to DB')

        const pkm = await UserPokemon.findOne()
        if (!pkm) {
            console.log('No UserPokemon found to test.')
            return
        }

        console.log(`Testing with Pokemon ID: ${pkm._id}`)

        const res = await fetch(`${API_URL}/pokemon/${pkm._id}`)
        const data = await res.json()

        console.log('Status:', res.status)
        if (data.ok) {
            console.log('Success!')
            console.log('Name:', data.pokemon.pokemonId?.name)
            console.log('Stats:', data.pokemon.stats)
        } else {
            console.log('Failed:', data)
        }

    } catch (err) {
        console.error(err)
    } finally {
        await mongoose.disconnect()
    }
}

verify()
