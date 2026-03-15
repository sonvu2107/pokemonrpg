import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { searchMapForUserDirect } from '../services/autoSearchDirectService.js'
import { attackEncounterForUserDirect, usePokeballOnEncounterDirect } from '../services/autoSearchActionDirectService.js'

dotenv.config({ path: '.env' })

const API_BASE = String(process.env.PARITY_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '')
const ACCESS_TOKEN = String(process.env.PARITY_TOKEN || process.env.BENCH_TOKEN || '').trim()
const REFRESH_TOKEN = String(process.env.PARITY_REFRESH_TOKEN || process.env.BENCH_REFRESH_TOKEN || '').trim()
const MAP_SLUG = String(process.env.PARITY_MAP_SLUG || process.env.BENCH_MAP_SLUG || '').trim()
const BALL_ITEM_ID = String(process.env.PARITY_BALL_ITEM_ID || '').trim()
const EXPLICIT_USER_ID = String(process.env.PARITY_USER_ID || '').trim()
const MAX_SEARCH_ATTEMPTS = Math.max(1, Number.parseInt(process.env.PARITY_MAX_SEARCH_ATTEMPTS || '12', 10) || 12)

const decodeUserIdFromToken = (token = '') => {
    const parts = String(token || '').split('.')
    if (parts.length < 2) return ''
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        return String(payload?.userId || '').trim()
    } catch {
        return ''
    }
}

const createInternalToken = (userId = '') => {
    const normalizedUserId = String(userId || '').trim()
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    if (!normalizedUserId || !jwtSecret) return ''
    return jwt.sign(
        {
            userId: normalizedUserId,
            tokenType: 'internal',
        },
        jwtSecret,
        { expiresIn: '30m' }
    )
}

const refreshUserId = decodeUserIdFromToken(REFRESH_TOKEN)
const fallbackUserId = EXPLICIT_USER_ID || refreshUserId
const fallbackInternalToken = ACCESS_TOKEN ? '' : createInternalToken(fallbackUserId)
const TOKEN = ACCESS_TOKEN || fallbackInternalToken

const USER_ID = EXPLICIT_USER_ID || decodeUserIdFromToken(TOKEN) || refreshUserId

const requestHttp = async ({ method = 'GET', path = '', body = null } = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })

    let payload = null
    try {
        payload = await response.json()
    } catch {
        payload = null
    }

    return {
        ok: response.ok,
        status: response.status,
        payload,
    }
}

const findEncounterHttp = async () => {
    for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt += 1) {
        const result = await requestHttp({ method: 'POST', path: '/game/search', body: { mapSlug: MAP_SLUG } })
        if (!result.ok) {
            throw new Error(`HTTP search failed: status=${result.status} message=${result.payload?.message || ''}`)
        }
        if (result.payload?.encountered && result.payload?.encounterId) {
            return result.payload
        }
    }

    throw new Error(`HTTP search did not encounter Pokemon after ${MAX_SEARCH_ATTEMPTS} attempts`)
}

const findEncounterDirect = async () => {
    for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt += 1) {
        const payload = await searchMapForUserDirect({
            userId: USER_ID,
            mapSlug: MAP_SLUG,
            role: 'vip',
            vipTierLevel: 0,
        })
        if (payload?.encountered && payload?.encounterId) {
            return payload
        }
    }

    throw new Error(`Direct search did not encounter Pokemon after ${MAX_SEARCH_ATTEMPTS} attempts`)
}

const keyDiff = (left = {}, right = {}) => {
    const leftKeys = new Set(Object.keys(left || {}))
    const rightKeys = new Set(Object.keys(right || {}))
    const missingInRight = [...leftKeys].filter((key) => !rightKeys.has(key)).sort()
    const extraInRight = [...rightKeys].filter((key) => !leftKeys.has(key)).sort()
    return {
        missingInRight,
        extraInRight,
    }
}

async function main() {
    if (!TOKEN) {
        throw new Error('Missing PARITY_TOKEN (or BENCH_TOKEN), or provide PARITY_REFRESH_TOKEN with JWT_SECRET to auto-generate internal token')
    }
    if (!USER_ID) {
        throw new Error('Missing PARITY_USER_ID and cannot decode userId from token')
    }
    if (!MAP_SLUG) {
        throw new Error('Missing PARITY_MAP_SLUG (or BENCH_MAP_SLUG)')
    }

    const mongoUri = String(process.env.MONGO_URI || '').trim()
    if (!mongoUri) {
        throw new Error('Missing MONGO_URI')
    }

    await mongoose.connect(mongoUri)

    try {
        const directEncounterForAttack = await findEncounterDirect()
        const attackDirect = await attackEncounterForUserDirect({
            userId: USER_ID,
            encounterId: String(directEncounterForAttack.encounterId),
        })

        const httpEncounterForAttack = await findEncounterHttp()
        const attackHttpRes = await requestHttp({
            method: 'POST',
            path: `/game/encounter/${encodeURIComponent(String(httpEncounterForAttack.encounterId))}/attack`,
        })
        if (!attackHttpRes.ok) {
            throw new Error(`HTTP attack failed: status=${attackHttpRes.status} message=${attackHttpRes.payload?.message || ''}`)
        }

        const report = {
            ok: true,
            config: {
                apiBase: API_BASE,
                userId: USER_ID,
                mapSlug: MAP_SLUG,
                hasBallItemId: Boolean(BALL_ITEM_ID),
            },
            checks: {
                attack: keyDiff(attackHttpRes.payload || {}, attackDirect || {}),
            },
        }

        if (BALL_ITEM_ID) {
            const directEncounterForCatch = await findEncounterDirect()
            const catchDirect = await usePokeballOnEncounterDirect({
                userId: USER_ID,
                itemId: BALL_ITEM_ID,
                encounterId: String(directEncounterForCatch.encounterId),
                quantity: 1,
            })

            const httpEncounterForCatch = await findEncounterHttp()
            const catchHttpRes = await requestHttp({
                method: 'POST',
                path: '/inventory/use',
                body: {
                    itemId: BALL_ITEM_ID,
                    quantity: 1,
                    encounterId: String(httpEncounterForCatch.encounterId),
                },
            })
            if (!catchHttpRes.ok) {
                throw new Error(`HTTP catch failed: status=${catchHttpRes.status} message=${catchHttpRes.payload?.message || ''}`)
            }

            report.checks.catch = keyDiff(catchHttpRes.payload || {}, catchDirect || {})
        }

        report.ok = Object.values(report.checks).every((entry) => (
            Array.isArray(entry?.missingInRight)
            && entry.missingInRight.length === 0
        ))

        console.log(JSON.stringify(report, null, 2))
        if (!report.ok) {
            process.exitCode = 1
        }
    } finally {
        await mongoose.disconnect()
    }
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
