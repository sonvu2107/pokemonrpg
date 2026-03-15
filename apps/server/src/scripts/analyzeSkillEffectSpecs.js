import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Move from '../models/Move.js'
import { parseMoveEffectText } from '../battle/effects/effectParser.js'

dotenv.config({ path: '.env' })

const normalize = (value = '') => String(value || '').trim()
const normalizeLower = (value = '') => normalize(value).toLowerCase()

const parseSkillMarkdownRows = (content) => {
    const lines = String(content || '').split(/\r?\n/).map((line) => line.trim())
    const nonEmpty = lines.filter(Boolean)

    if (nonEmpty.length === 0) return []

    let dataLines = nonEmpty
    const headerStack = ['name', 'type', 'cat.', 'power', 'acc.', 'pp', 'effect', 'prob. (%)']
    const firstEight = nonEmpty.slice(0, 8).map((entry) => normalizeLower(entry))
    const matchesStackedHeader = headerStack.every((entry, index) => firstEight[index] === entry)
    if (matchesStackedHeader) {
        dataLines = nonEmpty.slice(8)
    }

    return dataLines
        .map((line) => line.split('\t'))
        .filter((cells) => cells.length >= 2)
        .map((cells) => ({
            name: normalize(cells[0]),
            type: normalize(cells[1]),
            category: normalize(cells[2]),
            power: normalize(cells[3]),
            accuracy: normalize(cells[4]),
            pp: normalize(cells[5]),
            effect: normalize(cells[6]),
            probability: normalize(cells[7]),
        }))
        .filter((entry) => Boolean(entry.name))
}

const summarize = (rows) => {
    const opCounter = new Map()
    const incompleteReasonCounter = new Map()
    const incompleteReasonSamples = new Map()
    const parsedRows = []
    const unparsedRows = []

    rows.forEach((row) => {
        const parsed = parseMoveEffectText({
            description: row.effect,
            probability: row.probability,
        })

        if (parsed.effectSpecs.length > 0) {
            parsedRows.push({ row, parsed })
            parsed.effectSpecs.forEach((spec) => {
                const op = String(spec.op || '').trim()
                if (!op) return
                opCounter.set(op, (opCounter.get(op) || 0) + 1)

                if (op !== 'no_op' && op !== 'flavor_only' && op !== 'unsupported_rule') return
                const reason = normalize(spec?.params?.reason || 'unknown') || 'unknown'
                incompleteReasonCounter.set(reason, (incompleteReasonCounter.get(reason) || 0) + 1)
                if (!incompleteReasonSamples.has(reason)) {
                    incompleteReasonSamples.set(reason, new Set())
                }
                const reasonSet = incompleteReasonSamples.get(reason)
                if (reasonSet.size < 8) {
                    reasonSet.add(row.name)
                }
            })
            return
        }

        if (normalize(row.effect)) {
            unparsedRows.push({ row, parsed })
        }
    })

    return {
        totalRows: rows.length,
        rowsWithEffectText: rows.filter((entry) => Boolean(normalize(entry.effect))).length,
        parsedRows: parsedRows.length,
        unparsedRows: unparsedRows.length,
        opFrequency: [...opCounter.entries()]
            .map(([op, count]) => ({ op, count }))
            .sort((a, b) => b.count - a.count || a.op.localeCompare(b.op)),
        noOpReasonFrequency: [...incompleteReasonCounter.entries()]
            .map(([reason, count]) => ({
                reason,
                count,
                sampleMoves: [...(incompleteReasonSamples.get(reason) || [])],
            }))
            .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        sampleParsed: parsedRows.slice(0, 10).map(({ row, parsed }) => ({
            name: row.name,
            effect: row.effect,
            probability: row.probability,
            effectSpecs: parsed.effectSpecs,
        })),
        sampleUnparsed: unparsedRows.slice(0, 20).map(({ row }) => ({
            name: row.name,
            effect: row.effect,
            probability: row.probability,
        })),
    }
}

async function maybeApplyToDatabase(rows) {
    if (!process.argv.includes('--apply')) {
        return {
            mode: 'dry-run',
            matchedMoves: 0,
            updatedMoves: 0,
            missingMoves: 0,
            sampleMissingMoves: [],
        }
    }

    if (!process.env.MONGO_URI) {
        throw new Error('Missing MONGO_URI environment variable for --apply mode')
    }

    await mongoose.connect(process.env.MONGO_URI)
    try {
        let matchedMoves = 0
        let updatedMoves = 0
        const missing = []

        for (const row of rows) {
            const parsed = parseMoveEffectText({
                description: row.effect,
                probability: row.probability,
            })
            if (parsed.effectSpecs.length === 0) continue

            const nameLower = normalizeLower(row.name)
            const move = await Move.findOne({ nameLower })
            if (!move) {
                missing.push(row.name)
                continue
            }

            matchedMoves += 1
            move.effectSpecs = parsed.effectSpecs
            move.effects = {
                ...(move.effects && typeof move.effects === 'object' ? move.effects : {}),
                parserConfidence: parsed.parserConfidence,
                parserWarnings: parsed.parserWarnings,
            }
            await move.save()
            updatedMoves += 1
        }

        return {
            mode: 'apply',
            matchedMoves,
            updatedMoves,
            missingMoves: missing.length,
            sampleMissingMoves: missing.slice(0, 20),
        }
    } finally {
        await mongoose.disconnect()
    }
}

async function main() {
    const skillMdPath = path.resolve(process.cwd(), '..', '..', 'skill.md')
    const content = await fs.readFile(skillMdPath, 'utf8')
    const rows = parseSkillMarkdownRows(content)
    const summary = summarize(rows)
    const applyResult = await maybeApplyToDatabase(rows)

    console.log(JSON.stringify({
        ok: true,
        skillMdPath,
        ...summary,
        applyResult,
    }, null, 2))
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
    process.exitCode = 1
})
