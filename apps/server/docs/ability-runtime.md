# Ability Runtime

Tai lieu nay ghi lai semantic hien tai cua subsystem Ability trong server battle flow.

## Source Of Truth

- Ability trong tran dau la snapshot state trong `BattleSession`, khong doc live tu `UserPokemon` giua tran.
- State chinh:
  - `playerAbility`, `playerAbilitySuppressed`
  - `team[].ability`, `team[].abilitySuppressed`
  - `playerTeam[].ability`, `playerTeam[].abilitySuppressed`

## Semantic Da Tach Rieng

- Mutation ability: doi chuoi ability (`set/copy/swap`).
- Ignore per-resolution: bo qua ability cua target trong mot lan resolve.
- Suppression dai han: target bi khoa runtime ability qua nhieu luot.
- Attacker-side bypass (Mold Breaker style): attacker bo qua defensive ability cua target theo resolution.

## Rules Hien Tai

### Mutation

- Ordering: `set -> copy -> swap`.
- Chi mutate trong battle session state.

### Ignore Per-Resolution

- Ap dung trong context cua resolution hien tai.
- Khong mutate ability string.
- Khong ghi state dai han.

### Suppression

- La battle-session state (`abilitySuppressed`).
- Khi suppressed: runtime hook cua battler bi skip.
- Hien tai clear khi battler roi san (switch out/forced switch).
- Suppression khong doi chuoi `ability`.

### Mold Breaker Style

- Duoc model la attacker-side bypass, khong phai suppression.
- Khong mutate target ability, khong persist state moi.
- Nhom ability dang map vao bypass: `mold_breaker`, `teravolt`, `turboblaze`.

## Hook Bypass Policy Matrix

Matrix nam o `src/battle/abilities/abilityBypassPolicy.js`.

- `hit_defense`: `moveIgnore=true`, `attackerBypass=true`
- `status_guard`: `moveIgnore=true`, `attackerBypass=true`
- `type_immunity`: `moveIgnore=true`, `attackerBypass=true`
- `speed_modifier`: `moveIgnore=false`, `attackerBypass=false`
- `switch_in_reaction`: `moveIgnore=false`, `attackerBypass=false`
- `end_turn_passive`: `moveIgnore=false`, `attackerBypass=false`

Runtime phai hoi policy thay vi hardcode if/else trong route.

## Thu Tu Check

Khi resolve defensive hook cua target:

1. Kiem tra bypass theo policy (move-ignore / attacker-bypass).
2. Kiem tra suppression state cua target.
3. Neu khong bi bypass/suppressed thi moi goi `applyAbilityHook`.

## Test Suite

Chay toan bo regression Ability bang:

```bash
npm run test:ability
```

Script nay gom:

- runtime hooks
- mutation ops
- ignore resolution
- suppression flow
- mold breaker flow
- bypass policy matrix
- snapshot regressions lien quan battle/ability
