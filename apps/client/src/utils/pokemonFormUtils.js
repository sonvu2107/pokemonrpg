export const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

export const resolvePokemonForm = (species = {}, requestedFormId = null) => {
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    const normalizedRequestedFormId = normalizeFormId(requestedFormId || defaultFormId)

    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === normalizedRequestedFormId) || null
    let resolvedFormId = normalizedRequestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return {
        form: resolvedForm,
        formId: resolvedFormId,
        formName: String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim(),
    }
}

export const resolvePokemonSprite = ({
    species = {},
    formId = null,
    isShiny = false,
    fallback = '',
    preferBack = false,
} = {}) => {
    const { form } = resolvePokemonForm(species, formId)

    const baseNormal = species?.imageUrl
        || species?.sprites?.normal
        || species?.sprites?.icon
        || species?.sprites?.front_default
        || fallback
    const formNormal = form?.imageUrl
        || form?.sprites?.normal
        || form?.sprites?.icon
        || baseNormal

    if (isShiny) {
        return form?.sprites?.shiny || species?.sprites?.shiny || formNormal || fallback
    }

    if (preferBack) {
        return form?.sprites?.back_default
            || formNormal
            || species?.sprites?.back_default
            || baseNormal
            || fallback
    }

    return formNormal || baseNormal || fallback
}
