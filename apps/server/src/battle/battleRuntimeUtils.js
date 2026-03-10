import { normalizePokemonTypes } from './typeSystem.js'

const WEATHER_CHIP_IMMUNITY = {
    hail: new Set(['ice']),
    sandstorm: new Set(['rock', 'ground', 'steel']),
}

export const rollDamage = (level) => {
    const base = Math.max(5, Math.floor(level * 0.6))
    return base + Math.floor(Math.random() * 6)
}

export const applyPercentBonus = (baseValue = 0, bonusPercent = 0) => {
    const normalizedBase = Math.max(0, Math.floor(Number(baseValue) || 0))
    const normalizedPercent = Math.max(0, Number(bonusPercent) || 0)
    if (normalizedBase <= 0 || normalizedPercent <= 0) return normalizedBase
    return Math.max(1, Math.floor(normalizedBase * (1 + (normalizedPercent / 100))))
}

export const applyPercentMultiplier = (baseValue = 0, bonusPercent = 0) => {
    const normalizedBase = Math.max(0, Number(baseValue) || 0)
    const normalizedPercent = Math.max(0, Number(bonusPercent) || 0)
    if (normalizedBase <= 0 || normalizedPercent <= 0) return normalizedBase
    return normalizedBase * (1 + (normalizedPercent / 100))
}

export const isImmuneToWeatherChip = (weather = '', pokemonTypes = []) => {
    const normalizedWeather = String(weather || '').trim().toLowerCase()
    const immuneTypes = WEATHER_CHIP_IMMUNITY[normalizedWeather]
    if (!immuneTypes) return true
    const types = normalizePokemonTypes(pokemonTypes)
    return types.some((type) => immuneTypes.has(type))
}
