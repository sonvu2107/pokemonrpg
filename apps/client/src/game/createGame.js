import Phaser from 'phaser'

/**
 * Factory function to create Phaser game instance
 * @param {HTMLElement} container - DOM element to mount game
 * @param {Array} scenes - Array of Phaser Scene classes
 * @param {Object} config - Additional Phaser config overrides
 * @returns {Phaser.Game} - Phaser game instance
 */
export function createGame(container, scenes = [], config = {}) {
    const defaultConfig = {
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        parent: container,
        backgroundColor: '#2c3e50',
        scene: scenes,
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
        },
    }

    // Merge default config with overrides
    const finalConfig = {
        ...defaultConfig,
        ...config,
        scale: {
            ...defaultConfig.scale,
            ...(config.scale || {}),
        },
    }

    return new Phaser.Game(finalConfig)
}
