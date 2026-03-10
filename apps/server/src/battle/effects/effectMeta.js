const TITLE_WORD_OVERRIDES = {
    hp: 'HP',
    ko: 'KO',
    pp: 'PP',
    crit: 'Critical',
}

const VI_WORD_OVERRIDES = {
    apply: 'ap dung',
    status: 'trang thai',
    clear: 'xoa',
    stat: 'chi so',
    stage: 'bac',
    random: 'ngau nhien',
    power: 'suc manh',
    modifier: 'dieu chinh',
    by: 'theo',
    user: 'nguoi dung',
    target: 'muc tieu',
    hp: 'HP',
    with: 'voi',
    if: 'neu',
    set: 'thiet lap',
    terrain: 'dia hinh',
    weather: 'thoi tiet',
    bind: 'troi buoc',
    recoil: 'phan sat thuong',
    heal: 'hoi mau',
    fraction: 'ti le',
    max: 'toi da',
    damage: 'sat thuong',
    never: 'khong bao gio',
    miss: 'truot',
    always: 'luon',
    crit: 'chi mang',
    rate: 'ti le',
    priority: 'uu tien',
    require: 'bat buoc',
    copy: 'sao chep',
    swap: 'hoan doi',
    steal: 'cuop',
    boost: 'tang cuong',
    move: 'chieu',
    block: 'chan',
    shield: 'la chan',
    transfer: 'chuyen',
    ignore: 'bo qua',
    use: 'su dung',
    defense: 'phong thu',
    attack: 'tan cong',
    higher: 'cao hon',
    offense: 'tan cong',
    recharge: 'hoi suc',
    force: 'ep buoc',
    faint: 'xiu',
    survive: 'song sot',
    next: 'lan tiep',
    normal: 'thuong',
    electric: 'dien',
    become: 'tro thanh',
    flavor: 'mo ta',
    only: 'chi',
    stages: 'bac chi so',
    atk: 'tan cong',
    def: 'phong thu',
    spatk: 'tan cong dac biet',
    spdef: 'phong thu dac biet',
    spd: 'toc do',
    random: 'ngau nhien',
    current: 'hien tai',
    value: 'gia tri',
    from: 'tu',
    level: 'cap do',
    guards: 'la chan',
    reduction: 'giam',
    userhp: 'HP nguoi dung',
}

const OP_META_OVERRIDES = {
    apply_status: { nameEn: 'Apply Status', nameVi: 'Gay trang thai' },
    apply_status_random: { nameVi: 'Gay mot trang thai ngau nhien' },
    apply_status_if: { nameVi: 'Gay trang thai theo dieu kien' },
    always_crit: { nameVi: 'Dam bao chi mang' },
    apply_bind: { nameVi: 'Gay troi buoc theo turn' },
    average_attack_spatk_stages_with_target: { nameVi: 'Can bang bac Tan cong va Tan cong dac biet voi muc tieu' },
    average_def_spdef_stages_with_target: { nameVi: 'Can bang bac Phong thu va Phong thu dac biet voi muc tieu' },
    clear_status: { nameEn: 'Clear Status', nameVi: 'Xoa trang thai' },
    clear_status_if: { nameVi: 'Xoa trang thai theo dieu kien' },
    clear_damage_guards: { nameVi: 'Xoa la chan giam sat thuong' },
    clear_stat_stages: { nameVi: 'Xoa toan bo bac chi so' },
    clear_terrain: { nameVi: 'Xoa dia hinh' },
    copy_target_stat_stages: { nameVi: 'Sao chep bac chi so cua muc tieu' },
    crash_damage_on_miss_fraction_max_hp: { nameVi: 'Tu gay sat thuong khi hut don' },
    crit_rate: { nameVi: 'Tang ti le chi mang' },
    damage_fraction_target_current_hp: { nameVi: 'Gay sat thuong theo HP hien tai cua muc tieu' },
    damage_reduction_shield: { nameEn: 'Damage Shield', nameVi: 'La chan giam sat thuong' },
    enforce_target_survive: { nameVi: 'Khong de muc tieu bi ha guc' },
    fixed_damage_from_user_level: { nameVi: 'Sat thuong co dinh theo cap do nguoi dung' },
    fixed_damage_value: { nameVi: 'Sat thuong co dinh' },
    force_target_ko: { nameVi: 'Ha guc muc tieu ngay lap tuc' },
    heal_fraction_damage: { nameVi: 'Hoi mau theo sat thuong gay ra' },
    heal_fraction_max_hp: { nameVi: 'Hoi mau theo phan tram HP toi da' },
    heal_fraction_max_hp_if: { nameVi: 'Hoi mau theo dieu kien' },
    hp_fraction_cost_max_hp: { nameVi: 'Tieu hao HP theo phan tram toi da' },
    ignore_damage_guards: { nameVi: 'Bo qua la chan giam sat thuong' },
    ignore_target_stat_stages: { nameVi: 'Bo qua bac chi so cua muc tieu' },
    invert_target_stat_stages: { nameVi: 'Dao nguoc bac chi so cua muc tieu' },
    multi_hit: { nameVi: 'Tan cong nhieu lan' },
    never_miss: { nameVi: 'Khong bao gio truot' },
    power_modifier_if: { nameEn: 'Conditional Power Modifier', nameVi: 'Dieu chinh suc manh theo dieu kien' },
    power_modifier_by_user_hp: { nameEn: 'Power by User HP', nameVi: 'Dieu chinh suc manh theo HP nguoi dung' },
    power_modifier_random: { nameVi: 'Dieu chinh suc manh ngau nhien' },
    prevent_repeat_move: { nameVi: 'Khong cho lap lai chieu vua dung' },
    priority_mod: { nameVi: 'Dieu chinh do uu tien' },
    priority_mod_if: { nameVi: 'Dieu chinh do uu tien theo dieu kien' },
    require_recharge: { nameEn: 'Require Recharge', nameVi: 'Buoc hoi suc' },
    require_terrain: { nameVi: 'Bat buoc co dia hinh' },
    set_crit_block: { nameVi: 'Chan sat thuong chi mang' },
    set_damage_to_user_current_hp: { nameVi: 'Sat thuong bang HP hien tai cua nguoi dung' },
    set_heal_block: { nameVi: 'Chan hoi mau' },
    set_next_attack_always_crit: { nameVi: 'Cu danh tiep theo dam bao chi mang' },
    set_next_attack_never_miss: { nameVi: 'Cu danh tiep theo khong truot' },
    set_normal_moves_become_electric: { nameVi: 'Bien chieu Normal thanh Electric' },
    set_stat_drop_shield: { nameVi: 'Chan giam bac chi so' },
    set_status_move_block: { nameVi: 'Chan dung chieu trang thai' },
    set_status_shield: { nameVi: 'Chan gay trang thai' },
    set_terrain: { nameVi: 'Tao dia hinh' },
    set_weather: { nameVi: 'Tao thoi tiet' },
    self_faint: { nameVi: 'Nguoi dung tu xiu' },
    stat_stage: { nameEn: 'Change Stat Stage', nameVi: 'Tang/giam bac chi so' },
    stat_stage_if: { nameVi: 'Tang/giam bac chi so theo dieu kien' },
    stat_stage_random: { nameVi: 'Tang ngau nhien mot chi so' },
    stat_stage_set: { nameVi: 'Dat truc tiep bac chi so' },
    steal_target_stat_boosts: { nameVi: 'Cuop cac bac chi so duong cua muc tieu' },
    swap_attack_spatk_stages_with_target: { nameVi: 'Hoan doi bac Tan cong va Tan cong dac biet voi muc tieu' },
    swap_all_stat_stages_with_target: { nameVi: 'Hoan doi toan bo bac chi so voi muc tieu' },
    swap_def_spdef_stages_with_target: { nameVi: 'Hoan doi bac Phong thu va Phong thu dac biet voi muc tieu' },
    swap_speed_stages_with_target: { nameVi: 'Hoan doi bac Toc do voi muc tieu' },
    swap_user_attack_defense_stages: { nameVi: 'Hoan doi bac Tan cong va Phong thu cua nguoi dung' },
    transfer_status_to_target: { nameVi: 'Chuyen trang thai cua nguoi dung sang muc tieu' },
    use_defense_as_attack: { nameVi: 'Dung Phong thu thay cho Tan cong' },
    use_higher_offense_stat: { nameVi: 'Dung chi so tan cong cao hon' },
    use_target_attack_as_attack: { nameVi: 'Dung chi so Tan cong cua muc tieu' },
    flavor_only: { nameEn: 'Flavor Only', nameVi: 'Chi mo ta (chua mo phong)' },
    no_op: { nameEn: 'No Operation', nameVi: 'Khong co xu ly' },
}

const REASON_META_OVERRIDES = {
    z_move_flavor: { nameEn: 'Z-Move Flavor Text', nameVi: 'Mo ta Z-Move' },
    gmax_move_flavor: { nameEn: 'G-Max Flavor Text', nameVi: 'Mo ta G-Max' },
    dynamax_move_flavor: { nameEn: 'Dynamax Flavor Text', nameVi: 'Mo ta Dynamax' },
    explicit_no_battle_effect: { nameEn: 'No Battle Effect', nameVi: 'Khong co hieu ung chien dau' },
    unmodeled_effect: { nameEn: 'Unmodeled Effect', nameVi: 'Hieu ung chua duoc mo phong' },
}

const splitSnakeCase = (value = '') => String(value || '').trim().toLowerCase().split('_').filter(Boolean)

const toTitleCase = (value = '') => {
    const words = splitSnakeCase(value)
    if (words.length === 0) return ''
    return words
        .map((word) => {
            if (TITLE_WORD_OVERRIDES[word]) return TITLE_WORD_OVERRIDES[word]
            return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
        })
        .join(' ')
}

const toVietnameseLikeLabel = (value = '') => {
    const words = splitSnakeCase(value)
    if (words.length === 0) return ''
    return words.map((word) => VI_WORD_OVERRIDES[word] || word).join(' ')
}

export const isImplementedEffectOp = (op = '') => {
    const normalized = String(op || '').trim().toLowerCase()
    if (!normalized) return false
    return normalized !== 'flavor_only' && normalized !== 'no_op'
}

export const buildEffectOpMeta = (op = '') => {
    const normalized = String(op || '').trim().toLowerCase()
    if (!normalized) {
        return {
            id: '',
            nameEn: '',
            nameVi: '',
            isImplemented: false,
        }
    }

    const override = OP_META_OVERRIDES[normalized] || {}
    return {
        id: normalized,
        nameEn: override.nameEn || toTitleCase(normalized),
        nameVi: override.nameVi || toVietnameseLikeLabel(normalized),
        isImplemented: isImplementedEffectOp(normalized),
    }
}

export const buildEffectReasonMeta = (reason = '') => {
    const normalized = String(reason || '').trim().toLowerCase() || 'unmodeled_effect'
    const override = REASON_META_OVERRIDES[normalized] || {}
    return {
        id: normalized,
        nameEn: override.nameEn || toTitleCase(normalized),
        nameVi: override.nameVi || toVietnameseLikeLabel(normalized),
    }
}

const DEFAULT_TRIGGER_OPTIONS = ['on_hit', 'after_damage', 'on_calculate_damage', 'on_select_move', 'before_accuracy_check', 'before_opponent_accuracy_check', 'before_damage_taken', 'on_miss']
const DEFAULT_TARGET_OPTIONS = ['self', 'opponent', 'field']

const EFFECT_TEMPLATE_OVERRIDES = {
    apply_status: { trigger: 'on_hit', target: 'opponent', chance: 1, params: { status: 'burn' } },
    apply_status_random: { trigger: 'on_hit', target: 'opponent', chance: 0.3, params: { statuses: ['burn', 'poison'] } },
    clear_status: { trigger: 'on_hit', target: 'self', chance: 1, params: {} },
    clear_status_if: { trigger: 'on_hit', target: 'self', chance: 1, params: { condition: 'user_is_burned' } },
    stat_stage: { trigger: 'on_hit', target: 'opponent', chance: 1, params: { stat: 'atk', delta: -1 } },
    stat_stage_if: { trigger: 'on_hit', target: 'self', chance: 1, params: { condition: 'target_was_damaged_last_turn', stat: 'atk', delta: 1 } },
    power_modifier_if: { trigger: 'on_calculate_damage', target: 'self', chance: 1, params: { condition: 'weather_sunny', multiplier: 1.5 } },
    power_modifier_by_user_hp: { trigger: 'on_calculate_damage', target: 'self', chance: 1, params: { mode: 'higher' } },
    multi_hit: { trigger: 'on_hit', target: 'opponent', chance: 1, params: { min: 2, max: 5 } },
    apply_bind: { trigger: 'on_hit', target: 'opponent', chance: 1, params: { turns: 4, fraction: 0.125 } },
    heal_fraction_damage: { trigger: 'after_damage', target: 'self', chance: 1, params: { fraction: 0.5 } },
    heal_fraction_max_hp: { trigger: 'on_hit', target: 'self', chance: 1, params: { fraction: 0.5 } },
    set_weather: { trigger: 'on_hit', target: 'field', chance: 1, params: { weather: 'rain', turns: 5 } },
    set_terrain: { trigger: 'on_hit', target: 'field', chance: 1, params: { terrain: 'electric', turns: 5 } },
    require_recharge: { trigger: 'on_hit', target: 'self', chance: 1, params: { turns: 1 } },
    damage_reduction_shield: { trigger: 'on_hit', target: 'self', chance: 1, params: { scope: 'all', multiplier: 0, turns: 1 } },
    set_status_move_block: { trigger: 'on_hit', target: 'opponent', chance: 1, params: { turns: 3 } },
    copy_target_stat_stages: { trigger: 'on_hit', target: 'self', chance: 1, params: {} },
    steal_target_stat_boosts: { trigger: 'on_hit', target: 'self', chance: 1, params: {} },
}

export const getDefaultEffectSpecForOp = (op = '') => {
    const normalized = String(op || '').trim().toLowerCase()
    const template = EFFECT_TEMPLATE_OVERRIDES[normalized] || {}
    return {
        op: normalized,
        trigger: template.trigger || 'on_hit',
        target: template.target || 'opponent',
        chance: Number.isFinite(Number(template.chance)) ? Number(template.chance) : 1,
        params: template.params && typeof template.params === 'object' ? template.params : {},
    }
}

export const getEffectTriggerOptions = () => [...DEFAULT_TRIGGER_OPTIONS]
export const getEffectTargetOptions = () => [...DEFAULT_TARGET_OPTIONS]
