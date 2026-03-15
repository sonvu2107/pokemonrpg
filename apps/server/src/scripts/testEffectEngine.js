import assert from 'assert'
import { parseMoveEffectText } from '../battle/effects/effectParser.js'
import { applyEffectSpecs } from '../battle/effects/effectRegistry.js'
import {
    getDefaultEffectSpecForOp,
    getEffectTriggerOptions,
    isImplementedEffectOp,
} from '../battle/effects/effectMeta.js'

const runParserTests = () => {
    const parsed = parseMoveEffectText({
        description: 'High critical hit ratio. May burn the opponent.',
        probability: '30%',
    })

    const ops = new Set(parsed.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(ops.has('crit_rate'), 'Expected crit_rate effect from parser')
    assert(ops.has('apply_status'), 'Expected apply_status effect from parser')

    const parsedUtility = parseMoveEffectText({
        description: "Lowers user's Defense and Special Defense. Restores a little HP each turn. User receives recoil damage.",
        probability: '100%',
    })
    const utilityOps = new Set(parsedUtility.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(utilityOps.has('stat_stage'), 'Expected stat_stage from multi-stat parser')
    assert(utilityOps.has('heal_fraction_max_hp'), 'Expected heal_fraction_max_hp from parser')
    assert(utilityOps.has('recoil_fraction_damage'), 'Expected recoil_fraction_damage from parser')

    const parsedConditional = parseMoveEffectText({
        description: 'Power doubles if opponent already took damage in the same turn. Stronger when the user does not have a held item.',
        probability: '100%',
    })
    const conditionalOps = new Set(parsedConditional.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(conditionalOps.has('power_modifier_if'), 'Expected power_modifier_if from parser')

    const parsedShield = parseMoveEffectText({
        description: 'Halves damage from Physical and Special attacks for five turns.',
        probability: '—',
    })
    const shieldOps = new Set(parsedShield.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(shieldOps.has('damage_reduction_shield'), 'Expected damage_reduction_shield from parser')

    const parsedBellyDrum = parseMoveEffectText({
        description: 'User loses 50% of its max HP, but Attack raises to maximum.',
        probability: '—',
    })
    const bellyDrumOps = new Set(parsedBellyDrum.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(bellyDrumOps.has('hp_fraction_cost_max_hp'), 'Expected hp_fraction_cost_max_hp from parser')
    assert(bellyDrumOps.has('stat_stage_set'), 'Expected stat_stage_set from parser')

    const parsedRandomStat = parseMoveEffectText({
        description: 'Sharply raises a random stat.',
        probability: '—',
    })
    const randomStatOps = new Set(parsedRandomStat.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(randomStatOps.has('stat_stage_random'), 'Expected stat_stage_random from parser')

    const parsedCure = parseMoveEffectText({
        description: 'Cures all status problems in your party.',
        probability: '—',
    })
    const cureOps = new Set(parsedCure.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(cureOps.has('clear_status'), 'Expected clear_status from parser')

    const parsedRecharge = parseMoveEffectText({
        description: 'User must recharge next turn.',
        probability: '—',
    })
    const rechargeOps = new Set(parsedRecharge.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(rechargeOps.has('require_recharge'), 'Expected require_recharge from parser')

    const parsedNoRepeat = parseMoveEffectText({
        description: 'Cannot be used twice in a row.',
        probability: '—',
    })
    const noRepeatOps = new Set(parsedNoRepeat.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(noRepeatOps.has('prevent_repeat_move'), 'Expected prevent_repeat_move from parser')

    const parsedBind = parseMoveEffectText({
        description: 'Traps opponent, damaging them for 4-5 turns.',
        probability: '100',
    })
    const bindOps = new Set(parsedBind.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(bindOps.has('apply_bind'), 'Expected apply_bind from parser')

    const parsedBodyPress = parseMoveEffectText({
        description: "The higher the user's Defense, the stronger the attack.",
        probability: '—',
    })
    const bodyPressOps = new Set(parsedBodyPress.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(bodyPressOps.has('use_defense_as_attack'), 'Expected use_defense_as_attack from parser')

    const parsedActsFirstConditional = parseMoveEffectText({
        description: 'If the user attacks before the target, the power of this move is doubled.',
        probability: '—',
    })
    const actsFirstOps = new Set(parsedActsFirstConditional.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(actsFirstOps.has('power_modifier_if'), 'Expected power_modifier_if for acts-first condition')

    const parsedNoOp = parseMoveEffectText({
        description: 'Dark type Z-Move.',
        probability: '—',
    })
    const noOpOps = new Set(parsedNoOp.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(noOpOps.has('set_move_variant'), 'Expected set_move_variant for Z-Move classification text')

    const parsedBrine = parseMoveEffectText({
        description: "Power doubles if opponent's HP is less than 50%.",
        probability: '—',
    })
    const brineOps = new Set(parsedBrine.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(brineOps.has('power_modifier_if'), 'Expected power_modifier_if for HP threshold')

    const parsedEruption = parseMoveEffectText({
        description: "The higher the user's HP, the higher the power.",
        probability: '—',
    })
    const eruptionOps = new Set(parsedEruption.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(eruptionOps.has('power_modifier_by_user_hp'), 'Expected power_modifier_by_user_hp for high-HP scaling wording')

    const parsedReversal = parseMoveEffectText({
        description: "The lower the user's HP, the higher the power.",
        probability: '—',
    })
    const reversalOps = new Set(parsedReversal.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(reversalOps.has('power_modifier_by_user_hp'), 'Expected power_modifier_by_user_hp for low-HP scaling wording')

    const parsedElectroBall = parseMoveEffectText({
        description: 'The faster the user, the stronger the attack.',
        probability: '—',
    })
    const electroBallOps = new Set(parsedElectroBall.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(electroBallOps.has('power_modifier_by_speed_relation'), 'Expected power_modifier_by_speed_relation for speed-based wording')

    const parsedGyroBall = parseMoveEffectText({
        description: 'The slower the user, the stronger the attack.',
        probability: '—',
    })
    const gyroBallOps = new Set(parsedGyroBall.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(gyroBallOps.has('power_modifier_by_speed_relation'), 'Expected power_modifier_by_speed_relation for inverse speed wording')

    const parsedWringOut = parseMoveEffectText({
        description: "The higher the opponent's HP, the higher the damage.",
        probability: '—',
    })
    const wringOutOps = new Set(parsedWringOut.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(wringOutOps.has('power_modifier_by_target_hp'), 'Expected power_modifier_by_target_hp for target HP scaling wording')

    const parsedGrassKnot = parseMoveEffectText({
        description: 'The heavier the opponent, the stronger the attack.',
        probability: '—',
    })
    const grassKnotOps = new Set(parsedGrassKnot.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(grassKnotOps.has('power_modifier_by_target_hp'), 'Expected power_modifier_by_target_hp approximation for weight-based wording')

    const parsedOutrage = parseMoveEffectText({
        description: 'Attacks for 2-3 turns but then becomes confused.',
        probability: '—',
    })
    const outrageOps = new Set(parsedOutrage.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(outrageOps.has('require_recharge'), 'Expected require_recharge approximation for multi-turn lock wording')

    const parsedSpite = parseMoveEffectText({
        description: "The opponent's last move loses 2-5 PP.",
        probability: '—',
    })
    const spiteOps = new Set(parsedSpite.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(spiteOps.has('set_status_move_block'), 'Expected set_status_move_block approximation for PP loss wording')

    const parsedBrickBreak = parseMoveEffectText({
        description: 'Breaks through Reflect and Light Screen barriers.',
        probability: '—',
    })
    const brickBreakOps = new Set(parsedBrickBreak.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(brickBreakOps.has('clear_damage_guards'), 'Expected clear_damage_guards from parser')

    const parsedBurningJealousy = parseMoveEffectText({
        description: 'Hits all opponents, and burns any that have had their stats boosted.',
        probability: '100',
    })
    const burningJealousyOps = new Set(parsedBurningJealousy.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(burningJealousyOps.has('apply_status_if'), 'Expected apply_status_if for conditional burn')

    const parsedNoBattleEffect = parseMoveEffectText({
        description: 'No battle effect.',
        probability: '—',
    })
    const noBattleEffectOps = new Set(parsedNoBattleEffect.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(noBattleEffectOps.has('no_battle_effect'), 'Expected no_battle_effect for explicit no battle effect text')

    const parsedClearSmog = parseMoveEffectText({
        description: "Removes all of the target's stat changes.",
        probability: '—',
    })
    const clearSmogOps = new Set(parsedClearSmog.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(clearSmogOps.has('clear_stat_stages'), 'Expected clear_stat_stages from parser')

    const parsedChipAway = parseMoveEffectText({
        description: "Ignores opponent's stat changes.",
        probability: '—',
    })
    const chipAwayOps = new Set(parsedChipAway.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(chipAwayOps.has('ignore_target_stat_stages'), 'Expected ignore_target_stat_stages from parser')

    const parsedClangorousSoul = parseMoveEffectText({
        description: "Raises all user's stats but loses HP.",
        probability: '100',
    })
    const clangorousSoulOps = new Set(parsedClangorousSoul.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(clangorousSoulOps.has('stat_stage'), 'Expected stat_stage from Clangorous Soul parser')
    assert(clangorousSoulOps.has('hp_fraction_cost_max_hp'), 'Expected hp_fraction_cost_max_hp from Clangorous Soul parser')

    const parsedConstrict = parseMoveEffectText({
        description: "May lower opponent's Speed by one stage.",
        probability: '10',
    })
    const constrictOps = new Set(parsedConstrict.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(constrictOps.has('stat_stage'), 'Expected stat_stage from Constrict wording')

    const parsedDig = parseMoveEffectText({
        description: 'Digs underground on first turn, attacks on second. Can also escape from caves.',
        probability: '—',
    })
    const digOps = new Set(parsedDig.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(digOps.has('require_recharge'), 'Expected require_recharge approximation from two-turn digging wording')

    const parsedTaunt = parseMoveEffectText({
        description: 'Opponent can only use moves that attack.',
        probability: '—',
    })
    const tauntOps = new Set(parsedTaunt.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(tauntOps.has('set_status_move_block'), 'Expected set_status_move_block from taunt-style wording')

    const parsedSpectralThief = parseMoveEffectText({
        description: "The user hides in the target's shadow, steals the target's stat boosts, and then attacks.",
        probability: '—',
    })
    const spectralOps = new Set(parsedSpectralThief.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(spectralOps.has('steal_target_stat_boosts'), 'Expected steal_target_stat_boosts from Spectral Thief wording')

    const parsedSpikyShield = parseMoveEffectText({
        description: 'Protects the user and inflicts damage on contact.',
        probability: '—',
    })
    const spikyOps = new Set(parsedSpikyShield.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(spikyOps.has('damage_reduction_shield'), 'Expected protect-contact wording to map to damage_reduction_shield')

    const parsedCounter = parseMoveEffectText({
        description: 'When hit by a Physical Attack, user strikes back with 2x power.',
        probability: '—',
    })
    const counterOps = new Set(parsedCounter.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(counterOps.has('power_modifier_if'), 'Expected conditional power modifier for Counter wording')

    const parsedDragonRage = parseMoveEffectText({
        description: 'Always inflicts 40 HP.',
        probability: '—',
    })
    const dragonRageOps = new Set(parsedDragonRage.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(dragonRageOps.has('fixed_damage_value'), 'Expected fixed_damage_value for fixed-damage wording')

    const parsedNightShade = parseMoveEffectText({
        description: "Inflicts damage equal to user's level.",
        probability: '—',
    })
    const nightShadeOps = new Set(parsedNightShade.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(nightShadeOps.has('fixed_damage_from_user_level'), 'Expected fixed_damage_from_user_level from parser')

    const parsedSuperFang = parseMoveEffectText({
        description: "Always takes off half of the opponent's HP.",
        probability: '—',
    })
    const superFangOps = new Set(parsedSuperFang.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(superFangOps.has('damage_fraction_target_current_hp'), 'Expected damage_fraction_target_current_hp from parser')

    const parsedPsychoShift = parseMoveEffectText({
        description: "Transfers user's status condition to the opponent.",
        probability: '—',
    })
    const psychoShiftOps = new Set(parsedPsychoShift.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(psychoShiftOps.has('transfer_status_to_target'), 'Expected transfer_status_to_target from parser')

    const parsedPsychUp = parseMoveEffectText({
        description: "Copies the opponent's stat changes.",
        probability: '—',
    })
    const psychUpOps = new Set(parsedPsychUp.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(psychUpOps.has('copy_target_stat_stages'), 'Expected copy_target_stat_stages from parser')

    const parsedPowerShift = parseMoveEffectText({
        description: 'Switches Attack and Defense stats.',
        probability: '—',
    })
    const powerShiftOps = new Set(parsedPowerShift.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(powerShiftOps.has('swap_user_attack_defense_stages'), 'Expected swap_user_attack_defense_stages from parser')

    const parsedPowerSplit = parseMoveEffectText({
        description: 'Averages Attack and Special Attack with the target.',
        probability: '—',
    })
    const powerSplitOps = new Set(parsedPowerSplit.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(powerSplitOps.has('average_attack_spatk_stages_with_target'), 'Expected average_attack_spatk_stages_with_target from parser')

    const parsedPowerSwap = parseMoveEffectText({
        description: 'User and opponent swap Attack and Special Attack.',
        probability: '—',
    })
    const powerSwapOps = new Set(parsedPowerSwap.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(powerSwapOps.has('swap_attack_spatk_stages_with_target'), 'Expected swap_attack_spatk_stages_with_target from parser')

    const parsedSpeedSwap = parseMoveEffectText({
        description: 'The user exchanges Speed stats with the target.',
        probability: '—',
    })
    const speedSwapOps = new Set(parsedSpeedSwap.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(speedSwapOps.has('swap_speed_stages_with_target'), 'Expected swap_speed_stages_with_target from parser')

    const parsedTopsyTurvy = parseMoveEffectText({
        description: 'Reverses stat changes of opponent.',
        probability: '—',
    })
    const topsyOps = new Set(parsedTopsyTurvy.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(topsyOps.has('invert_target_stat_stages'), 'Expected invert_target_stat_stages from parser')

    const parsedFacade = parseMoveEffectText({
        description: 'Power doubles if user is burned, poisoned, or paralyzed.',
        probability: '—',
    })
    const facadeOps = new Set(parsedFacade.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(facadeOps.has('power_modifier_if'), 'Expected power_modifier_if for Facade condition')

    const parsedLashOut = parseMoveEffectText({
        description: 'Double power if stats were lowered during the turn.',
        probability: '—',
    })
    const lashOutOps = new Set(parsedLashOut.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(lashOutOps.has('power_modifier_if'), 'Expected power_modifier_if for stat-drop conditional wording')

    const parsedFalseSwipe = parseMoveEffectText({
        description: 'Always leaves opponent with at least 1 HP.',
        probability: '—',
    })
    const falseSwipeOps = new Set(parsedFalseSwipe.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(falseSwipeOps.has('enforce_target_survive'), 'Expected enforce_target_survive from parser')

    const parsedFissure = parseMoveEffectText({
        description: 'One-Hit-KO, if it hits.',
        probability: '—',
    })
    const fissureOps = new Set(parsedFissure.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(fissureOps.has('force_target_ko'), 'Expected force_target_ko from parser')

    const parsedFinalGambit = parseMoveEffectText({
        description: "Inflicts damage equal to the user's remaining HP. User faints.",
        probability: '—',
    })
    const finalGambitOps = new Set(parsedFinalGambit.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(finalGambitOps.has('set_damage_to_user_current_hp'), 'Expected set_damage_to_user_current_hp from parser')
    assert(finalGambitOps.has('self_faint'), 'Expected self_faint from parser')

    const parsedFellStinger = parseMoveEffectText({
        description: "Drastically raises user's Attack if target is KO'd.",
        probability: '—',
    })
    const fellStingerOps = new Set(parsedFellStinger.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(fellStingerOps.has('stat_stage_if'), 'Expected stat_stage_if from Fell Stinger parser')

    const parsedFilletAway = parseMoveEffectText({
        description: 'Lowers HP but sharply boosts Attack, Special Attack, and Speed.',
        probability: '—',
    })
    const filletOps = new Set(parsedFilletAway.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(filletOps.has('hp_fraction_cost_max_hp'), 'Expected hp_fraction_cost_max_hp from Fillet Away parser')
    assert(filletOps.has('stat_stage'), 'Expected stat_stage from Fillet Away parser')

    const parsedFirstImpression = parseMoveEffectText({
        description: 'Although this move has great power, it only works the first turn the user is in battle.',
        probability: '—',
    })
    const firstImpressionOps = new Set(parsedFirstImpression.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(firstImpressionOps.has('unsupported_rule'), 'Expected unsupported_rule fallback for first-turn-only unsupported rule')

    const parsedFireLash = parseMoveEffectText({
        description: "The user strikes the target with a burning lash. This also lowers the target's Defense stat.",
        probability: '100',
    })
    const fireLashOps = new Set(parsedFireLash.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(fireLashOps.has('stat_stage'), 'Expected stat_stage from Fire Lash parser')

    const parsedFoulPlay = parseMoveEffectText({
        description: "Uses the opponent's Attack stat.",
        probability: '—',
    })
    const foulPlayOps = new Set(parsedFoulPlay.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(foulPlayOps.has('use_target_attack_as_attack'), 'Expected use_target_attack_as_attack from parser')

    const parsedFreezyFrost = parseMoveEffectText({
        description: 'Resets all stat changes.',
        probability: '—',
    })
    const freezyFrostOps = new Set(parsedFreezyFrost.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(freezyFrostOps.has('clear_stat_stages'), 'Expected clear_stat_stages from Freezy Frost parser')

    const parsedGmaxChiStrike = parseMoveEffectText({
        description: 'Machamp-exclusive G-Max Move. Increases critical hit ratio.',
        probability: '—',
    })
    const gmaxChiOps = new Set(parsedGmaxChiStrike.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(gmaxChiOps.has('set_move_variant'), 'Expected set_move_variant for G-Max classification text')
    assert(gmaxChiOps.has('crit_rate'), 'Expected crit_rate for G-Max Chi Strike text')

    const parsedGmaxCentiferno = parseMoveEffectText({
        description: 'Centiskorch-exclusive G-Max Move. Traps opponents for 4-5 turns.',
        probability: '100',
    })
    const gmaxCentiOps = new Set(parsedGmaxCentiferno.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(gmaxCentiOps.has('apply_bind'), 'Expected apply_bind for G-Max Centiferno text')

    const parsedLeafage = parseMoveEffectText({
        description: 'Strikes opponent with leaves.',
        probability: '—',
    })
    const leafageOps = new Set(parsedLeafage.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(!leafageOps.has('flavor_only'), 'Expected parser to avoid flavor_only for pure damage-only wording')

    const parsedProtect = parseMoveEffectText({
        description: 'Protects the user, but may fail if used consecutively.',
        probability: '—',
    })
    const protectOps = new Set(parsedProtect.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(protectOps.has('damage_reduction_shield'), 'Expected protect wording to map to damage_reduction_shield')

    const parsedBypassProtect = parseMoveEffectText({
        description: 'Can strike through Protect/Detect.',
        probability: '—',
    })
    const bypassProtectOps = new Set(parsedBypassProtect.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(bypassProtectOps.has('ignore_damage_guards'), 'Expected bypass-protect wording to map to ignore_damage_guards')

    const parsedPsystrike = parseMoveEffectText({
        description: "Inflicts damage based on the target's Defense, not Special Defense.",
        probability: '—',
    })
    const psystrikeOps = new Set(parsedPsystrike.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(psystrikeOps.has('use_target_defense_for_special'), 'Expected psyshock-like wording to map to defense override op')

    const parsedRainDance = parseMoveEffectText({
        description: 'Makes it rain for 5 turns.',
        probability: '—',
    })
    const rainDanceOps = new Set(parsedRainDance.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(rainDanceOps.has('set_weather'), 'Expected rain-setting wording to map to set_weather')

    const parsedWeatherBall = parseMoveEffectText({
        description: "Move's power and type changes with the weather.",
        probability: '—',
    })
    const weatherBallOps = new Set(parsedWeatherBall.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(weatherBallOps.has('power_modifier_if'), 'Expected weather-based type/power wording to map to power_modifier_if')

    const parsedTerrainPulse = parseMoveEffectText({
        description: 'Type and power change depending on the terrain in effect.',
        probability: '—',
    })
    const terrainPulseOps = new Set(parsedTerrainPulse.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(terrainPulseOps.has('power_modifier_if'), 'Expected terrain-based type/power wording to map to power_modifier_if')

    const parsedPsychicTerrain = parseMoveEffectText({
        description: 'Prevents priority moves from being used for 5 turns.',
        probability: '—',
    })
    const psychicTerrainOps = new Set(parsedPsychicTerrain.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(psychicTerrainOps.has('set_terrain'), 'Expected terrain wording to map to set_terrain')

    const parsedPhotonGeyser = parseMoveEffectText({
        description: 'Uses Attack or Special Attack stat, whichever is higher.',
        probability: '—',
    })
    const photonOps = new Set(parsedPhotonGeyser.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(photonOps.has('use_higher_offense_stat'), 'Expected Photon Geyser wording to map to use_higher_offense_stat')

    const parsedSafeguard = parseMoveEffectText({
        description: "The user's party is protected from status conditions.",
        probability: '—',
    })
    const safeguardOps = new Set(parsedSafeguard.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(safeguardOps.has('set_status_shield'), 'Expected Safeguard wording to map to set_status_shield')

    const parsedMagicCoat = parseMoveEffectText({
        description: 'Reflects moves that cause status conditions back to the attacker.',
        probability: '—',
    })
    const magicCoatOps = new Set(parsedMagicCoat.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(magicCoatOps.has('set_status_shield'), 'Expected Magic Coat wording to map to set_status_shield')

    const parsedMist = parseMoveEffectText({
        description: "User's stats cannot be changed for a period of time.",
        probability: '—',
    })
    const mistOps = new Set(parsedMist.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(mistOps.has('set_stat_drop_shield'), 'Expected Mist wording to map to set_stat_drop_shield')

    const parsedLaserFocus = parseMoveEffectText({
        description: "User's next attack is guaranteed to result in a critical hit.",
        probability: '—',
    })
    const laserFocusOps = new Set(parsedLaserFocus.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(laserFocusOps.has('set_next_attack_always_crit'), 'Expected Laser Focus wording to map to set_next_attack_always_crit')

    const parsedLockOn = parseMoveEffectText({
        description: "User's next attack is guaranteed to hit.",
        probability: '—',
    })
    const lockOnOps = new Set(parsedLockOn.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(lockOnOps.has('set_next_attack_never_miss'), 'Expected Lock-On wording to map to set_next_attack_never_miss')

    const parsedIceSpinner = parseMoveEffectText({
        description: 'Removes effects of terrain.',
        probability: '—',
    })
    const iceSpinnerOps = new Set(parsedIceSpinner.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(iceSpinnerOps.has('clear_terrain'), 'Expected terrain-clearing wording to map to clear_terrain')

    const parsedPsychicNoise = parseMoveEffectText({
        description: 'Deals damage and prevents target from healing.',
        probability: '—',
    })
    const psychicNoiseOps = new Set(parsedPsychicNoise.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(psychicNoiseOps.has('set_heal_block'), 'Expected heal-prevention wording to map to set_heal_block')

    const parsedHealPulse = parseMoveEffectText({
        description: "Restores half the target's max HP.",
        probability: '—',
    })
    const healPulseOps = new Set(parsedHealPulse.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(healPulseOps.has('heal_fraction_max_hp'), 'Expected target heal wording to map to heal_fraction_max_hp')

    const parsedJumpKick = parseMoveEffectText({
        description: 'If it misses, the user loses half its HP.',
        probability: '—',
    })
    const jumpKickOps = new Set(parsedJumpKick.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(jumpKickOps.has('crash_damage_on_miss_fraction_max_hp'), 'Expected crash-on-miss wording to map to crash damage op')

    const parsedGrassyGlide = parseMoveEffectText({
        description: 'High priority during Grassy Terrain.',
        probability: '—',
    })
    const grassyGlideOps = new Set(parsedGrassyGlide.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(grassyGlideOps.has('priority_mod_if'), 'Expected terrain-priority wording to map to priority_mod_if')

    const parsedSteelRoller = parseMoveEffectText({
        description: 'This move fails if no Terrain is in effect.',
        probability: '—',
    })
    const steelRollerOps = new Set(parsedSteelRoller.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(steelRollerOps.has('require_terrain'), 'Expected terrain requirement wording to map to require_terrain')

    const parsedShoreUp = parseMoveEffectText({
        description: 'The user regains up to half of its max HP. It restores more HP in a sandstorm.',
        probability: '—',
    })
    const shoreUpOps = new Set(parsedShoreUp.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(shoreUpOps.has('heal_fraction_max_hp_if'), 'Expected weather-scaled healing wording to map to heal_fraction_max_hp_if')

    const parsedFloralHealing = parseMoveEffectText({
        description: "Restores the target's HP by up to half of its max HP. It restores more HP when the terrain is grass.",
        probability: '—',
    })
    const floralHealingOps = new Set(parsedFloralHealing.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(floralHealingOps.has('heal_fraction_max_hp_if'), 'Expected terrain-scaled healing wording to map to heal_fraction_max_hp_if')

    const parsedExpandingForce = parseMoveEffectText({
        description: 'Increases power and hits all opponents on Psychic Terrain.',
        probability: '—',
    })
    const expandingForceOps = new Set(parsedExpandingForce.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(expandingForceOps.has('power_modifier_if'), 'Expected psychic-terrain power wording to map to power_modifier_if')

    const parsedLifeDew = parseMoveEffectText({
        description: 'User and teammates recover HP.',
        probability: '—',
    })
    const lifeDewOps = new Set(parsedLifeDew.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(lifeDewOps.has('heal_fraction_max_hp'), 'Expected team-heal wording to map to self heal_fraction_max_hp')

    const parsedKingsShield = parseMoveEffectText({
        description: "Protects the user and lowers opponent's Attack on contact.",
        probability: '—',
    })
    const kingsShieldOps = new Set(parsedKingsShield.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(kingsShieldOps.has('damage_reduction_shield'), 'Expected King\'s Shield wording to map to damage_reduction_shield')

    const parsedLuckyChant = parseMoveEffectText({
        description: 'Opponent cannot land critical hits for 5 turns.',
        probability: '—',
    })
    const luckyChantOps = new Set(parsedLuckyChant.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(luckyChantOps.has('set_crit_block'), 'Expected anti-crit wording to map to set_crit_block')

    const parsedSaltCure = parseMoveEffectText({
        description: 'Deals damage each turn; Steel and Water types are more affected.',
        probability: '—',
    })
    const saltCureOps = new Set(parsedSaltCure.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(saltCureOps.has('apply_bind'), 'Expected residual-damage wording to map to apply_bind')

    const parsedSnowscape = parseMoveEffectText({
        description: 'Raises Defense of Ice types for 5 turns.',
        probability: '—',
    })
    const snowscapeOps = new Set(parsedSnowscape.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(snowscapeOps.has('damage_reduction_shield'), 'Expected Snowscape wording to map to damage_reduction_shield')

    const parsedStickyWeb = parseMoveEffectText({
        description: "Lowers opponent's Speed when switching into battle.",
        probability: '—',
    })
    const stickyWebSpec = parsedStickyWeb.effectSpecs.find((entry) => String(entry?.op || '').trim() === 'set_entry_hazard')
    assert(Boolean(stickyWebSpec), 'Expected Sticky Web wording to map to set_entry_hazard')
    assert(String(stickyWebSpec?.params?.hazard || '') === 'sticky_web', 'Expected Sticky Web hazard id to be sticky_web')

    const parsedRapidSpinHazardClear = parseMoveEffectText({
        description: 'Removes the effects of entry hazards and substitute.',
        probability: '—',
    })
    const rapidSpinOps = new Set(parsedRapidSpinHazardClear.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(rapidSpinOps.has('clear_entry_hazards'), 'Expected hazard-clearing wording to map to clear_entry_hazards')

    const parsedIonDeluge = parseMoveEffectText({
        description: 'Changes Normal-type moves to Electric-type.',
        probability: '—',
    })
    const ionDelugeOps = new Set(parsedIonDeluge.effectSpecs.map((entry) => String(entry?.op || '').trim()))
    assert(ionDelugeOps.has('set_normal_moves_become_electric'), 'Expected Normal-to-Electric wording to map to set_normal_moves_become_electric')
}

const runRegistryTests = () => {
    const specs = [
        {
            op: 'never_miss',
            trigger: 'before_accuracy_check',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'apply_status',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 0.5,
            params: { status: 'burn', turns: 2 },
        },
        {
            op: 'heal_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
        },
        {
            op: 'heal_fraction_max_hp',
            trigger: 'end_turn',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
        },
        {
            op: 'recoil_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
        },
        {
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { scope: 'all', turns: 5, multiplier: 0.5 },
        },
        {
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'user_has_no_held_item', multiplier: 2 },
        },
        {
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
        },
        {
            op: 'stat_stage_set',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'atk', stage: 6 },
        },
        {
            op: 'stat_stage_random',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { delta: 2, stats: ['atk', 'def'] },
        },
        {
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
        },
        {
            op: 'prevent_repeat_move',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minTurns: 4, maxTurns: 5, fraction: 0.125 },
        },
        {
            op: 'use_defense_as_attack',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'flavor' },
        },
        {
            op: 'clear_damage_guards',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        },
        {
            op: 'apply_status_if',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { condition: 'target_has_stat_boost', status: 'burn' },
        },
        {
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'target_hp_below_half', multiplier: 2 },
        },
        {
            op: 'clear_stat_stages',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        },
        {
            op: 'steal_target_stat_boosts',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'copy_target_stat_stages',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'swap_user_attack_defense_stages',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'average_attack_spatk_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'swap_attack_spatk_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'swap_speed_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'invert_target_stat_stages',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        },
        {
            op: 'ignore_target_stat_stages',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'enforce_target_survive',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { minHp: 1 },
        },
        {
            op: 'force_target_ko',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'set_damage_to_user_current_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'self_faint',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'stat_stage_if',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'target_was_ko', stat: 'atk', delta: 3 },
        },
        {
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'user_has_status_ailment', multiplier: 2 },
        },
        {
            op: 'use_target_attack_as_attack',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'ignore_damage_guards',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'use_target_defense_for_special',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'rain', turns: 5 },
        },
        {
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'electric', turns: 5 },
        },
        {
            op: 'use_higher_offense_stat',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'set_status_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
        },
        {
            op: 'set_stat_drop_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
        },
        {
            op: 'set_next_attack_always_crit',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'set_next_attack_never_miss',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'priority_mod_if',
            trigger: 'on_select_move',
            target: 'self',
            chance: 1,
            params: { condition: 'terrain_grassy', delta: 1 },
        },
        {
            op: 'require_terrain',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'terrain_present' },
        },
        {
            op: 'set_heal_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 5 },
        },
        {
            op: 'set_status_move_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 3 },
        },
        {
            op: 'set_crit_block',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
        },
        {
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { fraction: 0.5 },
        },
        {
            op: 'heal_fraction_max_hp_if',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { condition: 'weather_sandstorm', fraction: 2 / 3 },
        },
        {
            op: 'crash_damage_on_miss_fraction_max_hp',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
        },
        {
            op: 'clear_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        },
        {
            op: 'set_normal_moves_become_electric',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
        },
    ]

    const result = applyEffectSpecs({
        effectSpecs: specs,
        context: {
            random: () => 0.4,
            dealtDamage: 80,
            userMaxHp: 120,
            userHasNoHeldItem: true,
            moveName: 'Hyper Beam',
            targetCurrentHp: 40,
            targetMaxHp: 100,
            targetStatStages: { atk: 2, def: -1, spatk: -3, spd: -2 },
            userStatStages: { atk: 1, def: 2, spatk: 3, spd: 4 },
            userStatus: 'burn',
            targetWasKo: true,
            terrain: 'grassy',
            weather: 'sandstorm',
        },
    })

    assert(result.statePatches?.self?.neverMiss === true, 'Expected neverMiss patch to be true')
    assert(result.statePatches?.opponent?.status === 'burn', 'Expected opponent burn status')
    assert(result.statePatches?.opponent?.statusTurns === 2, 'Expected statusTurns patch from apply_status')
    assert(result.statePatches?.self?.healHp === 30, 'Expected end-turn heal to override heal amount to 30')
    assert(result.statePatches?.self?.recoilHp === 20, 'Expected recoilHp = 20 from dealt damage')
    assert(result.statePatches?.self?.powerMultiplier === 2, 'Expected power multiplier patch from conditional op')
    assert(result.statePatches?.self?.damageGuards?.physical?.turns === 5, 'Expected physical damage guard turns = 5')
    assert(result.statePatches?.self?.damageGuards?.special?.turns === 5, 'Expected special damage guard turns = 5')
    assert(result.statePatches?.self?.selfHpCost === 60, 'Expected hp cost = 60 from max HP fraction')
    assert(result.statePatches?.self?.setStatStages?.atk === 2, 'Expected final atk stage set from swap-attack-spatk op')
    assert(result.statePatches?.self?.clearStatus === true, 'Expected clear status patch set')
    assert(result.statePatches?.self?.status === '', 'Expected status cleared by clear_status op')
    assert(Number.isFinite(Number(result.statePatches?.self?.statStages?.atk ?? result.statePatches?.self?.statStages?.def)), 'Expected random stat stage delta')
    assert(result.statePatches?.self?.volatileState?.rechargeTurns === 1, 'Expected recharge turn patch')
    assert(result.statePatches?.self?.volatileState?.lockedRepeatMoveName === 'Hyper Beam', 'Expected locked repeat move name')
    assert(result.statePatches?.opponent?.volatileState?.bindTurns >= 4, 'Expected bind turns from apply_bind')
    assert(result.statePatches?.self?.useDefenseAsAttack === true, 'Expected use defense as attack patch')
    assert(result.statePatches?.opponent?.clearDamageGuards === true, 'Expected clear damage guard patch')
    assert(result.statePatches?.opponent?.status === 'burn', 'Expected conditional status burn patch')
    assert(result.statePatches?.opponent?.clearStatStages === true, 'Expected clear stat stages patch')
    assert(result.statePatches?.self?.replaceStatStages?.atk === 2, 'Expected copied attack stage from target stat stages')
    assert(result.statePatches?.self?.replaceStatStages?.def === -1, 'Expected copied defense stage from target stat stages')
    assert(result.statePatches?.self?.setStatStages?.def === 1, 'Expected swapped defense stage from swap-user-atk-def op')
    assert(result.statePatches?.self?.setStatStages?.spatk === -3, 'Expected swapped spatk stage on user from swap-attack-spatk op')
    assert(result.statePatches?.self?.setStatStages?.spd === -2, 'Expected swapped speed stage on user from swap-speed op')
    assert(result.statePatches?.opponent?.setStatStages?.atk === -2, 'Expected inverted atk stage on opponent from invert-target op')
    assert(result.statePatches?.opponent?.setStatStages?.spatk === 3, 'Expected inverted spatk stage on opponent from invert-target op')
    assert(result.statePatches?.opponent?.setStatStages?.spd === 2, 'Expected inverted speed stage on opponent from invert-target op')
    assert(result.statePatches?.self?.ignoreTargetStatStages === true, 'Expected ignore target stat stages patch')
    assert(result.statePatches?.self?.minTargetHp === 1, 'Expected minimum target HP patch')
    assert(result.statePatches?.self?.forceTargetKo === true, 'Expected force target KO patch')
    assert(result.statePatches?.self?.fixedDamageFromUserCurrentHp === true, 'Expected fixed damage from user HP patch')
    assert(result.statePatches?.self?.selfFaint === true, 'Expected self faint patch')
    assert(result.statePatches?.self?.useTargetAttackAsAttack === true, 'Expected use-target-attack patch')
    assert(result.statePatches?.self?.ignoreDamageGuards === true, 'Expected ignore damage guards patch')
    assert(result.statePatches?.self?.useTargetDefenseForSpecial === true, 'Expected target defense for special patch')
    assert(result.statePatches?.self?.useHigherOffenseStat === true, 'Expected higher offense stat patch')
    assert(result.statePatches?.self?.volatileState?.statusShieldTurns === 5, 'Expected status shield turns patch')
    assert(result.statePatches?.self?.volatileState?.statDropShieldTurns === 5, 'Expected stat-drop shield turns patch')
    assert(result.statePatches?.self?.volatileState?.pendingAlwaysCrit === true, 'Expected pending always-crit flag patch')
    assert(result.statePatches?.self?.volatileState?.pendingNeverMiss === true, 'Expected pending never-miss flag patch')
    assert(result.statePatches?.self?.priorityDelta === 1, 'Expected conditional priority delta patch')
    assert(result.statePatches?.self?.requireTerrain === true, 'Expected require-terrain patch')
    assert(result.statePatches?.opponent?.volatileState?.healBlockTurns === 5, 'Expected heal-block turns patch on opponent')
    assert(result.statePatches?.opponent?.volatileState?.statusMoveBlockTurns === 3, 'Expected status-move block turns patch on opponent')
    assert(result.statePatches?.self?.volatileState?.critBlockTurns === 5, 'Expected anti-crit block turns patch on self')
    assert(result.statePatches?.opponent?.healHp === 66, 'Expected conditional target heal patch from weather-scaled heal')
    assert(Math.abs(Number(result.statePatches?.self?.crashDamageOnMissFractionMaxHp || 0) - 0.5) < 0.001, 'Expected crash-on-miss fraction patch')
    assert(result.statePatches?.field?.weather === 'rain', 'Expected weather patch from set_weather')
    assert(result.statePatches?.field?.terrain === 'electric', 'Expected terrain patch from set_terrain')
    assert(result.statePatches?.field?.clearTerrain === true, 'Expected clearTerrain field patch')
    assert(result.statePatches?.field?.normalMovesBecomeElectricTurns === 1, 'Expected Normal-to-Electric field patch')

    const stealBoostResult = applyEffectSpecs({
        effectSpecs: [{
            op: 'steal_target_stat_boosts',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        }],
        context: {
            random: () => 0.4,
            userStatStages: { atk: 1 },
            targetStatStages: { atk: 2, def: 3, spatk: -1 },
        },
    })
    assert(stealBoostResult.statePatches?.self?.setStatStages?.atk === 3, 'Expected stolen positive atk stage to be added to user')
    assert(stealBoostResult.statePatches?.self?.setStatStages?.def === 3, 'Expected stolen positive def stage to be added to user')
    assert(stealBoostResult.statePatches?.opponent?.setStatStages?.atk === 0, 'Expected stolen positive atk stage removed from target')
    assert(stealBoostResult.statePatches?.opponent?.setStatStages?.def === 0, 'Expected stolen positive def stage removed from target')
}

const runTriggerOrderTests = () => {
    const specs = [
        { op: 'priority_mod', trigger: 'on_select_move', target: 'self', chance: 1, params: { delta: 1 } },
        { op: 'never_miss', trigger: 'before_accuracy_check', target: 'self', chance: 1, params: {} },
        { op: 'apply_status', trigger: 'on_hit', target: 'opponent', chance: 0.5, params: { status: 'sleep' } },
        { op: 'heal_fraction_damage', trigger: 'after_damage', target: 'self', chance: 1, params: { fraction: 0.5 } },
        { op: 'heal_fraction_max_hp', trigger: 'end_turn', target: 'self', chance: 1, params: { fraction: 0.1 } },
        { op: 'no_op', trigger: 'on_hit', target: 'self', chance: 1, params: { reason: 'flavor' } },
    ]

    const byTrigger = (trigger) => specs.filter((entry) => entry.trigger === trigger)

    const selectResult = applyEffectSpecs({
        effectSpecs: byTrigger('on_select_move'),
        context: { random: () => 0.9 },
    })
    assert(selectResult.statePatches?.self?.priorityDelta === 1, 'Expected priority patch on select move')

    const accuracyResult = applyEffectSpecs({
        effectSpecs: byTrigger('before_accuracy_check'),
        context: { random: () => 0.9 },
    })
    assert(accuracyResult.statePatches?.self?.neverMiss === true, 'Expected forced-hit patch before accuracy')

    const onHitFail = applyEffectSpecs({
        effectSpecs: byTrigger('on_hit'),
        context: { random: () => 0.9 },
    })
    assert(!onHitFail.statePatches?.opponent?.status, 'Expected status not applied when chance fails')

    const onHitPass = applyEffectSpecs({
        effectSpecs: byTrigger('on_hit'),
        context: { random: () => 0.1 },
    })
    assert(onHitPass.statePatches?.opponent?.status === 'sleep', 'Expected status applied when chance passes')

    const afterDamageResult = applyEffectSpecs({
        effectSpecs: byTrigger('after_damage'),
        context: { random: () => 0.9, dealtDamage: 100 },
    })
    assert(afterDamageResult.statePatches?.self?.healHp === 50, 'Expected heal from dealt damage after hit')

    const endTurnResult = applyEffectSpecs({
        effectSpecs: byTrigger('end_turn'),
        context: { random: () => 0.9, userMaxHp: 200 },
    })
    assert(endTurnResult.statePatches?.self?.healHp === 20, 'Expected end-turn heal from max HP')
}

const runConditionalPowerTests = () => {
    const superEffective = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'is_super_effective', multiplier: 1.33 },
        }],
        context: { random: () => 0.5, isSuperEffective: true },
    })
    assert(Math.abs(Number(superEffective.statePatches?.self?.powerMultiplier || 0) - 1.33) < 0.001, 'Expected super-effective conditional multiplier')

    const hpRatio = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'target_hp_ratio_higher_than_user', multiplier: 1.5 },
        }],
        context: { random: () => 0.5, targetCurrentHp: 90, targetMaxHp: 100, userCurrentHp: 30, userMaxHp: 100 },
    })
    assert(Math.abs(Number(hpRatio.statePatches?.self?.powerMultiplier || 0) - 1.5) < 0.001, 'Expected hp-ratio conditional multiplier')

    const weatherConditional = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'weather_sunny', multiplier: 1.5 },
        }],
        context: { random: () => 0.5, weather: 'sun' },
    })
    assert(Math.abs(Number(weatherConditional.statePatches?.self?.powerMultiplier || 0) - 1.5) < 0.001, 'Expected weather-based conditional multiplier')

    const statDropConditional = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'user_has_stat_drop', multiplier: 2 },
        }],
        context: { random: () => 0.5, userStatStages: { atk: -1 } },
    })
    assert(Math.abs(Number(statDropConditional.statePatches?.self?.powerMultiplier || 0) - 2) < 0.001, 'Expected stat-drop conditional multiplier')

    const weatherPresentConditional = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'weather_present', multiplier: 2 },
        }],
        context: { random: () => 0.5, weather: 'rain' },
    })
    assert(Math.abs(Number(weatherPresentConditional.statePatches?.self?.powerMultiplier || 0) - 2) < 0.001, 'Expected weather-present conditional multiplier')

    const highHpScaling = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_by_user_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'higher' },
        }],
        context: { random: () => 0.5, userCurrentHp: 80, userMaxHp: 100 },
    })
    assert(Math.abs(Number(highHpScaling.statePatches?.self?.powerMultiplier || 0) - 0.8) < 0.001, 'Expected higher-mode HP scaling multiplier')

    const lowHpScaling = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_by_user_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'lower' },
        }],
        context: { random: () => 0.5, userCurrentHp: 25, userMaxHp: 100 },
    })
    assert(Math.abs(Number(lowHpScaling.statePatches?.self?.powerMultiplier || 0) - 1.625) < 0.001, 'Expected lower-mode HP scaling multiplier')

    const targetHpScaling = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_by_target_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'higher' },
        }],
        context: { random: () => 0.5, targetCurrentHp: 80, targetMaxHp: 100 },
    })
    assert(Math.abs(Number(targetHpScaling.statePatches?.self?.powerMultiplier || 0) - 0.8) < 0.001, 'Expected target HP scaling multiplier')

    const speedRelationScaling = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_by_speed_relation',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'faster' },
        }],
        context: { random: () => 0.5, userSpeed: 200, targetSpeed: 100 },
    })
    assert(Math.abs(Number(speedRelationScaling.statePatches?.self?.powerMultiplier || 0) - 2) < 0.001, 'Expected speed-relation scaling multiplier')

    const randomRangeScaling = applyEffectSpecs({
        effectSpecs: [{
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { minMultiplier: 1, maxMultiplier: 2 },
        }],
        context: { random: () => 0.5 },
    })
    assert(Math.abs(Number(randomRangeScaling.statePatches?.self?.powerMultiplier || 0) - 1.5) < 0.001, 'Expected ranged-random power multiplier')
}

const runFixedDamageAndStatusTransferTests = () => {
    const fixedDamage = applyEffectSpecs({
        effectSpecs: [{
            op: 'fixed_damage_value',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { value: 40 },
        }],
        context: { random: () => 0.5 },
    })
    assert(fixedDamage.statePatches?.self?.fixedDamageValue === 40, 'Expected fixedDamageValue patch from fixed_damage_value')

    const fixedFromLevel = applyEffectSpecs({
        effectSpecs: [{
            op: 'fixed_damage_from_user_level',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        }],
        context: { random: () => 0.5, userLevel: 55 },
    })
    assert(fixedFromLevel.statePatches?.self?.fixedDamageValue === 55, 'Expected fixedDamageValue from user level op')

    const halfHp = applyEffectSpecs({
        effectSpecs: [{
            op: 'damage_fraction_target_current_hp',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { fraction: 0.5 },
        }],
        context: { random: () => 0.5 },
    })
    assert(Math.abs(Number(halfHp.statePatches?.self?.fixedDamageFractionTargetCurrentHp || 0) - 0.5) < 0.001, 'Expected target-current-hp fraction patch')

    const transferStatus = applyEffectSpecs({
        effectSpecs: [{
            op: 'transfer_status_to_target',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        }],
        context: { random: () => 0.5, userStatus: 'burn', userStatusTurns: 2 },
    })
    assert(transferStatus.statePatches?.opponent?.status === 'burn', 'Expected target to receive transferred status')
    assert(transferStatus.statePatches?.self?.clearStatus === true, 'Expected user status clear after transfer')
}

const runEntryHazardRegistryTests = () => {
    const setHazardResult = applyEffectSpecs({
        effectSpecs: [{
            op: 'set_entry_hazard',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { hazard: 'sticky_web' },
        }],
        context: { random: () => 0.5 },
    })
    assert(setHazardResult.statePatches?.field?.setEntryHazard?.side === 'opponent', 'Expected set_entry_hazard side to preserve target side')
    assert(setHazardResult.statePatches?.field?.setEntryHazard?.hazard === 'sticky_web', 'Expected set_entry_hazard hazard id to be preserved')

    const clearHazardResult = applyEffectSpecs({
        effectSpecs: [{
            op: 'clear_entry_hazards',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
        }],
        context: { random: () => 0.5 },
    })
    assert(clearHazardResult.statePatches?.field?.clearEntryHazards?.side === 'self', 'Expected clear_entry_hazards side to preserve target side')
}

const runEffectMetaContractTests = () => {
    const defaultMultiHit = getDefaultEffectSpecForOp('multi_hit')
    assert(defaultMultiHit.params?.minHits === 2, 'Expected default multi_hit minHits=2')
    assert(defaultMultiHit.params?.maxHits === 5, 'Expected default multi_hit maxHits=5')

    const multiHitApplied = applyEffectSpecs({
        effectSpecs: [defaultMultiHit],
        context: { random: () => 0.5 },
    })
    assert(multiHitApplied.statePatches?.self?.multiHit?.minHits === 2, 'Expected runtime multi-hit minHits to follow default template')
    assert(multiHitApplied.statePatches?.self?.multiHit?.maxHits === 5, 'Expected runtime multi-hit maxHits to follow default template')

    const defaultApplyBind = getDefaultEffectSpecForOp('apply_bind')
    assert(defaultApplyBind.params?.minTurns === 4, 'Expected default apply_bind minTurns=4')
    assert(defaultApplyBind.params?.maxTurns === 5, 'Expected default apply_bind maxTurns=5')

    const bindApplied = applyEffectSpecs({
        effectSpecs: [defaultApplyBind],
        context: { random: () => 0 },
    })
    assert(bindApplied.statePatches?.opponent?.volatileState?.bindTurns === 4, 'Expected runtime bindTurns to follow default template minTurns')

    const triggerOptions = getEffectTriggerOptions()
    assert(triggerOptions.includes('end_turn'), 'Expected trigger options to include end_turn')

    assert(isImplementedEffectOp('unsupported_rule') === false, 'Expected unsupported_rule to be treated as incomplete')
}

const main = () => {
    runParserTests()
    runRegistryTests()
    runTriggerOrderTests()
    runConditionalPowerTests()
    runFixedDamageAndStatusTransferTests()
    runEntryHazardRegistryTests()
    runEffectMetaContractTests()
    console.log('Effect engine tests passed')
}

main()
