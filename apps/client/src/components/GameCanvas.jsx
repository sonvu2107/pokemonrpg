import { useEffect, useRef } from 'react'
import { createGame } from '../game/createGame'

/**
 * GameCanvas component - mounts Phaser game for specific scenes
 * @param {Array} scenes - Array of Phaser Scene classes to load
 * @param {Function} onReady - Optional callback when game is ready
 */
export default function GameCanvas({ scenes = [], onReady }) {
    const gameRef = useRef(null)
    const containerRef = useRef(null)

    useEffect(() => {
        // Only create game once when component mounts
        if (!containerRef.current || gameRef.current) return

        console.log('GameCanvas: Creating Phaser game with scenes:', scenes.map(s => s.name))

        // Create Phaser game using factory
        gameRef.current = createGame(containerRef.current, scenes)

        // Wait for scenes to be ready before accessing them
        const game = gameRef.current
        game.events.once('ready', () => {
            console.log('GameCanvas: Phaser game ready')
            if (onReady) {
                onReady(game)
            }
        })

        // Cleanup on unmount
        return () => {
            if (gameRef.current) {
                console.log('GameCanvas: Destroying Phaser game')
                gameRef.current.destroy(true)
                gameRef.current = null
            }
        }
    }, []) // Empty dependency array - only mount once

    return (
        <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center bg-gray-800 rounded-md overflow-hidden"
        />
    )
}
