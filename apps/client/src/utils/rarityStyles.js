export const RARITY_STYLES = {
    sss: {
        border: 'border-[3px] border-transparent', // Handled by CSS
        bg: 'bg-white',
        text: 'text-rose-500 font-extrabold',
        shadow: 'shadow-[0_0_15px_rgba(244,63,94,0.6)]',
        overlay: 'bg-gradient-to-t from-rose-900/20 to-transparent',
        frameClass: 'rarity-frame-sss', // Rainbow border
        badge: 'bg-rose-600 text-white',
        label: 'SSS'
    },
    ss: {
        border: 'border-[3px] border-red-500',
        bg: 'bg-red-50',
        text: 'text-red-700 font-bold',
        shadow: 'shadow-[0_0_10px_rgba(239,68,68,0.4)]',
        overlay: 'bg-red-100/30',
        frameClass: 'rarity-frame-ss', // Pulse red
        badge: 'bg-red-600 text-white',
        label: 'SS'
    },
    s: {
        border: 'border-[3px] border-amber-400',
        bg: 'bg-amber-50',
        text: 'text-amber-700 font-bold',
        shadow: 'shadow-[0_0_8px_rgba(251,191,36,0.4)]',
        overlay: 'bg-amber-100/30',
        frameClass: '',
        badge: 'bg-amber-500 text-white',
        label: 'S'
    },
    a: {
        border: 'border-2 border-purple-400',
        bg: 'bg-purple-50',
        text: 'text-purple-700 font-bold',
        shadow: 'shadow-sm',
        overlay: '',
        frameClass: '',
        badge: 'bg-purple-500 text-white',
        label: 'A'
    },
    b: {
        border: 'border-2 border-blue-400',
        bg: 'bg-blue-50',
        text: 'text-blue-700 font-bold',
        shadow: 'shadow-sm',
        overlay: '',
        frameClass: '',
        badge: 'bg-blue-500 text-white',
        label: 'B'
    },
    c: {
        border: 'border-2 border-emerald-400',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700 font-bold',
        shadow: 'shadow-sm',
        overlay: '',
        frameClass: '',
        badge: 'bg-emerald-500 text-white',
        label: 'C'
    },
    d: {
        border: 'border border-slate-200',
        bg: 'bg-white',
        text: 'text-slate-600 font-medium',
        shadow: 'shadow-sm hover:shadow-md',
        overlay: '',
        frameClass: '',
        badge: 'bg-slate-400 text-white',
        label: 'D'
    },
}

export const getRarityStyle = (rarity) => {
    const key = (rarity || 'd').toLowerCase()
    return RARITY_STYLES[key] || RARITY_STYLES.d
}
