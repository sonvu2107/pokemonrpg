import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')

export const getBulkItemUseLimit = (vipTierLevel = 0) => {
    const normalizedVipTierLevel = Math.max(0, Math.floor(Number(vipTierLevel) || 0))
    return Math.max(1, normalizedVipTierLevel + 1)
}

const clampQuantity = (value, maxSelectable) => {
    const parsed = Math.floor(Number(value) || 1)
    return Math.min(maxSelectable, Math.max(1, parsed))
}

const resolveDurationPreview = (item, quantity) => {
    if (String(item?.effectType || '') !== 'grantVipTier') return ''

    const targetVipLevel = Math.max(1, Number(item?.effectValue || 1))
    const durationPerUse = Math.max(1, Number(item?.effectValueMp || 1))
    const durationUnit = String(item?.effectDurationUnit || 'month') === 'week' ? 'tuần' : 'tháng'
    const totalDuration = durationPerUse * quantity
    return `Kích hoạt hoặc gia hạn VIP ${targetVipLevel} thêm ${formatNumber(totalDuration)} ${durationUnit}.`
}

export default function BulkItemUseModal({
    isOpen,
    onClose,
    item,
    inventoryQuantity = 0,
    vipTierLevel = 0,
    submitting = false,
    onConfirm,
    title = 'Dùng nhiều vật phẩm',
    extraContent = null,
    renderPreview = null,
    renderSubmitLabel = null,
}) {
    const batchLimit = useMemo(() => getBulkItemUseLimit(vipTierLevel), [vipTierLevel])
    const maxSelectable = useMemo(() => {
        const availableQuantity = Math.max(0, Math.floor(Number(inventoryQuantity) || 0))
        if (availableQuantity <= 0) return 0
        return Math.min(availableQuantity, batchLimit)
    }, [batchLimit, inventoryQuantity])
    const [quantity, setQuantity] = useState(maxSelectable > 0 ? 1 : 0)

    useEffect(() => {
        if (!isOpen) return
        setQuantity(maxSelectable > 0 ? 1 : 0)
    }, [isOpen, item?._id, item?.id, item?.itemId, maxSelectable])

    const previewContent = useMemo(() => {
        if (typeof renderPreview === 'function') {
            return renderPreview(item, quantity)
        }
        return resolveDurationPreview(item, quantity)
    }, [item, quantity, renderPreview])
    const submitLabel = useMemo(() => {
        if (typeof renderSubmitLabel === 'function') {
            return renderSubmitLabel(quantity)
        }
        return `Dùng x${formatNumber(quantity)}`
    }, [quantity, renderSubmitLabel])

    const handleSubmit = async (event) => {
        event.preventDefault()
        if (!item || !maxSelectable || submitting) return
        await onConfirm(clampQuantity(quantity, maxSelectable))
    }

    return (
        <Modal isOpen={isOpen} onClose={submitting ? () => {} : onClose} title={title} maxWidth="sm">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-slate-700">
                    <div className="font-bold text-blue-900">{item?.name || 'Vật phẩm'}</div>
                    <div className="mt-1">Đang có: <span className="font-bold">x{formatNumber(inventoryQuantity)}</span></div>
                    <div>Giới hạn mỗi lần: <span className="font-bold">{formatNumber(batchLimit)}</span> vật phẩm</div>
                    <div>VIP hiện tại: <span className="font-bold">{Math.max(0, Number(vipTierLevel || 0))}</span></div>
                </div>

                {extraContent}

                <div className="space-y-2">
                    <label htmlFor="bulk-item-use-quantity" className="block text-sm font-bold text-slate-700">
                        Số lượng muốn dùng
                    </label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setQuantity((prev) => clampQuantity((prev || 1) - 1, maxSelectable || 1))}
                            disabled={!maxSelectable || submitting || quantity <= 1}
                            className="h-10 w-10 rounded border border-slate-300 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            -
                        </button>
                        <input
                            id="bulk-item-use-quantity"
                            type="number"
                            min="1"
                            max={Math.max(1, maxSelectable)}
                            value={quantity || ''}
                            onChange={(event) => setQuantity(clampQuantity(event.target.value, maxSelectable || 1))}
                            disabled={!maxSelectable || submitting}
                            className="h-10 flex-1 rounded border border-blue-300 px-3 text-center text-base font-bold text-blue-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                        <button
                            type="button"
                            onClick={() => setQuantity((prev) => clampQuantity((prev || 0) + 1, maxSelectable || 1))}
                            disabled={!maxSelectable || submitting || quantity >= maxSelectable}
                            className="h-10 w-10 rounded border border-slate-300 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            +
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => setQuantity(maxSelectable || 1)}
                        disabled={!maxSelectable || submitting}
                        className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Dùng tối đa ({formatNumber(maxSelectable)})
                    </button>
                </div>

                {previewContent && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                        {previewContent}
                    </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        disabled={!maxSelectable || submitting}
                        className="rounded border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? 'Đang dùng...' : submitLabel}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
