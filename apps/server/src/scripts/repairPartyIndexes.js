import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import UserPokemon from '../models/UserPokemon.js'

dotenv.config()

const args = process.argv.slice(2)

const hasFlag = (flag) => args.includes(flag)

const getArgValue = (flag) => {
    const index = args.indexOf(flag)
    if (index < 0) return ''
    return String(args[index + 1] || '').trim()
}

const parseObjectIdArg = (flag) => {
    const raw = getArgValue(flag)
    if (!raw) return null
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new Error(`Gia tri ${flag} khong hop le: ${raw}`)
    }
    return new mongoose.Types.ObjectId(raw)
}

const isValidPartyIndex = (value) => Number.isInteger(value) && value >= 0 && value < 6

const toTime = (value) => {
    if (!value) return 0
    const date = new Date(value)
    const time = date.getTime()
    return Number.isFinite(time) ? time : 0
}

const toComparablePartyIndex = (value) => {
    const numeric = Number(value)
    return Number.isInteger(numeric) ? numeric : null
}

const comparePartyEntries = (left, right) => {
    const leftIndex = toComparablePartyIndex(left?.partyIndex)
    const rightIndex = toComparablePartyIndex(right?.partyIndex)
    const leftRank = isValidPartyIndex(leftIndex) ? leftIndex : 999
    const rightRank = isValidPartyIndex(rightIndex) ? rightIndex : 999

    if (leftRank !== rightRank) return leftRank - rightRank

    const leftUpdatedAt = toTime(left?.updatedAt)
    const rightUpdatedAt = toTime(right?.updatedAt)
    if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt

    const leftCreatedAt = toTime(left?.createdAt)
    const rightCreatedAt = toTime(right?.createdAt)
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt

    return String(left?._id || '').localeCompare(String(right?._id || ''))
}

const shouldApply = hasFlag('--apply')
const isDryRun = !shouldApply
const userIdFilter = parseObjectIdArg('--user-id')

const run = async () => {
    try {
        await connectDB()

        const distinctFilter = { location: 'party' }
        if (userIdFilter) {
            distinctFilter.userId = userIdFilter
        }

        const userIds = await UserPokemon.distinct('userId', distinctFilter)

        console.log('=== Repair Party Indexes ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Users with party entries: ${userIds.length}`)
        if (userIdFilter) {
            console.log(`Filter userId: ${String(userIdFilter)}`)
        }

        if (userIds.length === 0) {
            console.log('Khong co user nao can xu ly.')
            return
        }

        const stats = {
            usersScanned: 0,
            usersChanged: 0,
            partyPokemonScanned: 0,
            slotAssignmentsFixed: 0,
            overflowMovedToBox: 0,
            appliedUpdates: 0,
        }

        const preview = []

        for (const userId of userIds) {
            const entries = await UserPokemon.find({ userId, location: 'party' })
                .select('_id userId location partyIndex boxNumber createdAt updatedAt')
                .lean()

            if (!entries.length) continue

            stats.usersScanned += 1
            stats.partyPokemonScanned += entries.length

            const ordered = entries.slice().sort(comparePartyEntries)
            const bulkOps = []
            let userChanged = false

            ordered.forEach((entry, position) => {
                const currentPartyIndex = toComparablePartyIndex(entry?.partyIndex)
                const currentLocation = String(entry?.location || '')

                const targetInParty = position < 6
                const targetLocation = targetInParty ? 'party' : 'box'
                const targetPartyIndex = targetInParty ? position : null
                const normalizedCurrentBoxNumber = Number.isInteger(entry?.boxNumber) && entry.boxNumber > 0
                    ? entry.boxNumber
                    : 1
                const targetBoxNumber = targetInParty ? null : normalizedCurrentBoxNumber

                const needsUpdate = (
                    currentLocation !== targetLocation
                    || currentPartyIndex !== targetPartyIndex
                    || entry?.boxNumber !== targetBoxNumber
                )

                if (!needsUpdate) return

                userChanged = true
                if (targetInParty) {
                    stats.slotAssignmentsFixed += 1
                } else {
                    stats.overflowMovedToBox += 1
                }

                if (preview.length < 30) {
                    preview.push({
                        userId: String(userId),
                        pokemonId: String(entry?._id || ''),
                        from: {
                            location: currentLocation,
                            partyIndex: currentPartyIndex,
                            boxNumber: entry?.boxNumber ?? null,
                        },
                        to: {
                            location: targetLocation,
                            partyIndex: targetPartyIndex,
                            boxNumber: targetBoxNumber,
                        },
                    })
                }

                if (!isDryRun) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: entry._id },
                            update: {
                                $set: {
                                    location: targetLocation,
                                    partyIndex: targetPartyIndex,
                                    boxNumber: targetBoxNumber,
                                },
                            },
                        },
                    })
                }
            })

            if (!userChanged) continue

            stats.usersChanged += 1

            if (!isDryRun && bulkOps.length > 0) {
                const writeResult = await UserPokemon.bulkWrite(bulkOps, { ordered: true })
                stats.appliedUpdates += Number(writeResult.modifiedCount || 0)
            }
        }

        console.log(`Users scanned: ${stats.usersScanned}`)
        console.log(`Users changed: ${stats.usersChanged}`)
        console.log(`Party Pokemon scanned: ${stats.partyPokemonScanned}`)
        console.log(`Slot assignments fixed: ${stats.slotAssignmentsFixed}`)
        console.log(`Overflow moved to box: ${stats.overflowMovedToBox}`)
        console.log(`Applied updates: ${stats.appliedUpdates}`)
        console.log('Preview (max 30):')
        console.log(JSON.stringify(preview, null, 2))

        if (isDryRun) {
            console.log('Dry run hoan tat. Chua co du lieu nao bi thay doi.')
            console.log('Dung --apply de ap dung that.')
        }
    } catch (error) {
        console.error('Repair failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
