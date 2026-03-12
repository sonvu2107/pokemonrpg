import mongoose from 'mongoose'

let cachedTransactionSupport = null
let transactionSupportPromise = null
let hasLoggedStandaloneNotice = false

const logStandaloneNotice = () => {
    if (hasLoggedStandaloneNotice) return
    hasLoggedStandaloneNotice = true
    console.warn('MongoDB transactions disabled: connected server is not a replica set member or mongos')
}

const readTopologyInfo = async () => {
    const admin = mongoose.connection?.db?.admin?.()
    if (!admin) return null

    try {
        return await admin.command({ hello: 1 })
    } catch (error) {
        const errorMessage = String(error?.message || '').toLowerCase()
        if (error?.codeName === 'CommandNotFound' || errorMessage.includes('no such command')) {
            return admin.command({ isMaster: 1 })
        }
        throw error
    }
}

export const supportsMongoTransactions = async () => {
    if (cachedTransactionSupport !== null) {
        return cachedTransactionSupport
    }

    if (!transactionSupportPromise) {
        transactionSupportPromise = (async () => {
            try {
                const topologyInfo = await readTopologyInfo()
                const isReplicaSetMember = Boolean(topologyInfo?.setName)
                const isMongos = String(topologyInfo?.msg || '').trim() === 'isdbgrid'
                const supported = isReplicaSetMember || isMongos

                cachedTransactionSupport = supported
                if (!supported) {
                    logStandaloneNotice()
                }
                return supported
            } catch (error) {
                cachedTransactionSupport = false
                logStandaloneNotice()
                console.warn('MongoDB transaction support detection failed, falling back to non-transaction mode:', error?.message || error)
                return false
            } finally {
                transactionSupportPromise = null
            }
        })()
    }

    return transactionSupportPromise
}

export const attachSession = (query, session) => (session ? query.session(session) : query)

export const getSessionOptions = (session, extraOptions = {}) => (session
    ? { ...extraOptions, session }
    : { ...extraOptions })

export const runWithOptionalTransaction = async (work, options = {}) => {
    const useTransaction = options?.forceTransaction === true || await supportsMongoTransactions()

    if (!useTransaction) {
        return work(null)
    }

    const session = await mongoose.startSession()
    try {
        let result = null
        await session.withTransaction(async () => {
            result = await work(session)
        }, options?.transactionOptions)
        return result
    } finally {
        await session.endSession()
    }
}
