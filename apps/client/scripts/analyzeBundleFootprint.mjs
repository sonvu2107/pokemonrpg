import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST_DIR = path.resolve(process.cwd(), 'dist')
const BUNDLE_COMPARE_FILE = String(process.env.BUNDLE_COMPARE_FILE || '').trim()
const BUNDLE_OUT_FILE = String(process.env.BUNDLE_OUT_FILE || '').trim()

const ROUTE_GROUPS = [
    { key: 'admin-dashboard', route: '/admin' },
    { key: 'admin-news', route: '/admin/news' },
    { key: 'admin-users', route: '/admin/users' },
    { key: 'admin-pokemon', route: '/admin/pokemon' },
    { key: 'admin-maps', route: '/admin/maps' },
    { key: 'admin-battle', route: '/admin/battle' },
    { key: 'admin-catalog', route: '/admin/items|/admin/moves' },
    { key: 'admin-rewards', route: '/admin/daily-rewards|/admin/weekly-leaderboards|/admin/promo-codes' },
]

const toKb = (bytes = 0) => Number((Number(bytes || 0) / 1024).toFixed(2))
const round = (value = 0) => Number(Number(value || 0).toFixed(2))

const sum = (values = []) => values.reduce((total, value) => total + Number(value || 0), 0)

const formatVariant = (isLegacy) => (isLegacy ? 'legacy' : 'modern')

const resolveAssetsDir = async () => {
    const candidates = ['assets', 'assests']
    for (const candidate of candidates) {
        const candidatePath = path.resolve(DIST_DIR, candidate)
        try {
            const stat = await fs.stat(candidatePath)
            if (stat.isDirectory()) {
                return candidatePath
            }
        } catch {
            // try next candidate
        }
    }

    throw new Error(`Cannot find assets directory under ${DIST_DIR}`)
}

const collectJsAssets = async (assetsDir) => {
    const entries = await fs.readdir(assetsDir, { withFileTypes: true })
    const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.endsWith('.js'))

    const records = []
    for (const fileName of files) {
        const absolutePath = path.join(assetsDir, fileName)
        const content = await fs.readFile(absolutePath)
        const rawBytes = content.byteLength
        const gzipBytes = gzipSync(content).length
        records.push({
            fileName,
            rawBytes,
            gzipBytes,
            isLegacy: fileName.includes('-legacy-'),
        })
    }

    return records
}

const pickSharedChunks = (records = [], isLegacy = false) => {
    return records.filter((entry) => {
        if (entry.isLegacy !== isLegacy) return false
        return /^(index|vendor|AppShell|polyfills)-/.test(entry.fileName)
    })
}

const pickRouteChunk = (records = [], routeKey = '', isLegacy = false) => {
    return records.find((entry) => entry.isLegacy === isLegacy && entry.fileName.startsWith(`${routeKey}-`)) || null
}

const buildVariantReport = (records = [], isLegacy = false) => {
    const sharedChunks = pickSharedChunks(records, isLegacy)
    const sharedRawBytes = sum(sharedChunks.map((entry) => entry.rawBytes))
    const sharedGzipBytes = sum(sharedChunks.map((entry) => entry.gzipBytes))

    const routes = ROUTE_GROUPS.map((group) => {
        const routeChunk = pickRouteChunk(records, group.key, isLegacy)
        const routeRaw = Number(routeChunk?.rawBytes || 0)
        const routeGzip = Number(routeChunk?.gzipBytes || 0)

        return {
            route: group.route,
            chunk: routeChunk?.fileName || '',
            coldLoadRawKb: toKb(sharedRawBytes + routeRaw),
            coldLoadGzipKb: toKb(sharedGzipBytes + routeGzip),
            warmRouteRawKb: toKb(routeRaw),
            warmRouteGzipKb: toKb(routeGzip),
        }
    })

    return {
        variant: formatVariant(isLegacy),
        shared: {
            chunks: sharedChunks.map((entry) => entry.fileName),
            rawKb: toKb(sharedRawBytes),
            gzipKb: toKb(sharedGzipBytes),
        },
        routes,
    }
}

const buildComparison = async (variants = []) => {
    if (!BUNDLE_COMPARE_FILE) return null

    try {
        const raw = await fs.readFile(BUNDLE_COMPARE_FILE, 'utf8')
        const baseline = JSON.parse(raw)
        const baselineVariants = Array.isArray(baseline?.variants) ? baseline.variants : []
        const baselineByVariant = new Map(baselineVariants.map((entry) => [String(entry?.variant || ''), entry]))

        const rows = []
        for (const variant of variants) {
            const variantKey = String(variant?.variant || '')
            const baselineVariant = baselineByVariant.get(variantKey)
            if (!baselineVariant) {
                rows.push({ variant: variantKey, hasBaseline: false, routes: [] })
                continue
            }

            const baselineRoutes = Array.isArray(baselineVariant?.routes) ? baselineVariant.routes : []
            const baselineRouteMap = new Map(baselineRoutes.map((entry) => [String(entry?.route || ''), entry]))
            const deltaPercent = (before, after) => {
                const numericBefore = Number(before)
                const numericAfter = Number(after)
                if (!Number.isFinite(numericBefore) || numericBefore <= 0 || !Number.isFinite(numericAfter)) return null
                return round(((numericAfter - numericBefore) / numericBefore) * 100)
            }

            const comparedRoutes = (Array.isArray(variant?.routes) ? variant.routes : []).map((routeEntry) => {
                const baselineRoute = baselineRouteMap.get(String(routeEntry?.route || ''))
                if (!baselineRoute) {
                    return {
                        route: routeEntry?.route || '',
                        hasBaseline: false,
                    }
                }

                return {
                    route: routeEntry?.route || '',
                    hasBaseline: true,
                    before: {
                        coldLoadRawKb: Number(baselineRoute?.coldLoadRawKb || 0),
                        warmRouteRawKb: Number(baselineRoute?.warmRouteRawKb || 0),
                    },
                    after: {
                        coldLoadRawKb: Number(routeEntry?.coldLoadRawKb || 0),
                        warmRouteRawKb: Number(routeEntry?.warmRouteRawKb || 0),
                    },
                    deltaPercent: {
                        coldLoadRawKb: deltaPercent(baselineRoute?.coldLoadRawKb, routeEntry?.coldLoadRawKb),
                        warmRouteRawKb: deltaPercent(baselineRoute?.warmRouteRawKb, routeEntry?.warmRouteRawKb),
                    },
                }
            })

            rows.push({
                variant: variantKey,
                hasBaseline: true,
                routes: comparedRoutes,
            })
        }

        return {
            compareFile: BUNDLE_COMPARE_FILE,
            rows,
        }
    } catch (error) {
        return {
            compareFile: BUNDLE_COMPARE_FILE,
            error: String(error?.message || error),
            rows: [],
        }
    }
}

async function main() {
    const assetsDir = await resolveAssetsDir()
    const records = await collectJsAssets(assetsDir)
    const variants = [
        buildVariantReport(records, false),
        buildVariantReport(records, true),
    ]
    const comparison = await buildComparison(variants)

    const report = {
        ok: true,
        generatedAt: new Date().toISOString(),
        distAssetsDir: assetsDir,
        variants,
        comparison,
    }

    if (BUNDLE_OUT_FILE) {
        await fs.writeFile(BUNDLE_OUT_FILE, JSON.stringify(report, null, 2), 'utf8')
    }

    console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
