const IMAGE_LINE_PATTERN = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/
const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/
const UNORDERED_LIST_PATTERN = /^-\s+(.+)$/
const ORDERED_LIST_PATTERN = /^\d+\.\s+(.+)$/
const INLINE_TOKEN_PATTERN = /(\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*\*[^*]+\*\*|\*[^*]+\*)/g

const parseContentBlocks = (content = '') => {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
    const blocks = []
    let paragraphLines = []
    let unorderedItems = []
    let orderedItems = []

    const flushParagraph = () => {
        if (paragraphLines.length === 0) return
        const text = paragraphLines.join('\n').trim()
        paragraphLines = []
        if (!text) return
        blocks.push({ type: 'paragraph', text })
    }

    const flushUnorderedItems = () => {
        if (unorderedItems.length === 0) return
        blocks.push({ type: 'unordered-list', items: [...unorderedItems] })
        unorderedItems = []
    }

    const flushOrderedItems = () => {
        if (orderedItems.length === 0) return
        blocks.push({ type: 'ordered-list', items: [...orderedItems] })
        orderedItems = []
    }

    const flushAll = () => {
        flushParagraph()
        flushUnorderedItems()
        flushOrderedItems()
    }

    for (const rawLine of lines) {
        const line = String(rawLine || '')
        const trimmedLine = line.trim()

        if (!trimmedLine) {
            flushAll()
            continue
        }

        const imageMatch = trimmedLine.match(IMAGE_LINE_PATTERN)
        if (imageMatch) {
            flushAll()
            blocks.push({
                type: 'image',
                altText: String(imageMatch[1] || '').trim(),
                imageUrl: String(imageMatch[2] || '').trim(),
            })
            continue
        }

        const headingMatch = trimmedLine.match(HEADING_PATTERN)
        if (headingMatch) {
            flushAll()
            blocks.push({
                type: 'heading',
                level: Math.min(3, Math.max(1, headingMatch[1].length)),
                text: String(headingMatch[2] || '').trim(),
            })
            continue
        }

        const unorderedMatch = trimmedLine.match(UNORDERED_LIST_PATTERN)
        if (unorderedMatch) {
            flushParagraph()
            flushOrderedItems()
            unorderedItems.push(String(unorderedMatch[1] || '').trim())
            continue
        }

        const orderedMatch = trimmedLine.match(ORDERED_LIST_PATTERN)
        if (orderedMatch) {
            flushParagraph()
            flushUnorderedItems()
            orderedItems.push(String(orderedMatch[1] || '').trim())
            continue
        }

        flushUnorderedItems()
        flushOrderedItems()
        paragraphLines.push(line)
    }

    flushAll()
    return blocks
}

const renderInlineContent = (text = '', keyPrefix = '') => {
    const value = String(text || '')
    const nodes = []
    let lastIndex = 0
    INLINE_TOKEN_PATTERN.lastIndex = 0

    let match = INLINE_TOKEN_PATTERN.exec(value)
    while (match) {
        const token = String(match[0] || '')
        const start = match.index

        if (start > lastIndex) {
            nodes.push(value.slice(lastIndex, start))
        }

        if (token.startsWith('[')) {
            const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
            if (linkMatch) {
                nodes.push(
                    <a
                        key={`${keyPrefix}-link-${start}`}
                        href={linkMatch[2]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:text-blue-800 underline"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {linkMatch[1]}
                    </a>
                )
            } else {
                nodes.push(token)
            }
        } else if (token.startsWith('**') && token.endsWith('**')) {
            nodes.push(
                <strong key={`${keyPrefix}-strong-${start}`} className="font-bold text-slate-800">
                    {token.slice(2, -2)}
                </strong>
            )
        } else if (token.startsWith('*') && token.endsWith('*')) {
            nodes.push(
                <em key={`${keyPrefix}-em-${start}`} className="italic">
                    {token.slice(1, -1)}
                </em>
            )
        } else {
            nodes.push(token)
        }

        lastIndex = start + token.length
        match = INLINE_TOKEN_PATTERN.exec(value)
    }

    if (lastIndex < value.length) {
        nodes.push(value.slice(lastIndex))
    }

    return nodes
}

export const hasInlineImageInContent = (content = '') => {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
    return lines.some((line) => IMAGE_LINE_PATTERN.test(String(line || '').trim()))
}

export default function ArticleContentRenderer({ content, title = '', framedImages = false }) {
    const blocks = parseContentBlocks(content)

    return (
        <div className="space-y-3">
            {blocks.map((block, index) => {
                if (block.type === 'image' && block.imageUrl) {
                    return (
                        <div key={`image-${index}`} className={framedImages ? 'rounded-xl bg-gradient-to-b from-blue-400 to-cyan-400 p-1 shadow-md' : ''}>
                            <div className={`overflow-hidden rounded ${framedImages ? 'border-2 border-white' : 'border border-blue-100'}`}>
                                <img
                                    src={block.imageUrl}
                                    alt={block.altText || `${title} - ảnh minh họa`}
                                    className="w-full max-h-[420px] object-cover"
                                />
                            </div>
                        </div>
                    )
                }

                if (block.type === 'heading') {
                    const headingClass = block.level === 1
                        ? 'text-2xl font-extrabold text-slate-900'
                        : block.level === 2
                            ? 'text-xl font-bold text-slate-800'
                            : 'text-lg font-bold text-slate-700'

                    return (
                        <h3 key={`heading-${index}`} className={headingClass}>
                            {renderInlineContent(block.text, `heading-${index}`)}
                        </h3>
                    )
                }

                if (block.type === 'unordered-list') {
                    return (
                        <ul key={`ul-${index}`} className="list-disc pl-5 space-y-1 text-slate-700">
                            {block.items.map((item, itemIndex) => (
                                <li key={`ul-${index}-${itemIndex}`}>
                                    {renderInlineContent(item, `ul-${index}-${itemIndex}`)}
                                </li>
                            ))}
                        </ul>
                    )
                }

                if (block.type === 'ordered-list') {
                    return (
                        <ol key={`ol-${index}`} className="list-decimal pl-5 space-y-1 text-slate-700">
                            {block.items.map((item, itemIndex) => (
                                <li key={`ol-${index}-${itemIndex}`}>
                                    {renderInlineContent(item, `ol-${index}-${itemIndex}`)}
                                </li>
                            ))}
                        </ol>
                    )
                }

                if (block.type === 'paragraph' && block.text) {
                    return (
                        <p key={`paragraph-${index}`} className="whitespace-pre-wrap leading-relaxed text-slate-700">
                            {renderInlineContent(block.text, `paragraph-${index}`)}
                        </p>
                    )
                }

                return null
            })}
        </div>
    )
}
