import Phaser from 'phaser'

export default class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' })
    }

    create() {
        const { width, height } = this.cameras.main

        // Create a simple clickable pokemon sprite (circle for demo)
        const pokemon = this.add.circle(width / 2, height / 2, 80, 0xff6b6b)
        pokemon.setInteractive({ useHandCursor: true })

        // Add click animation
        pokemon.on('pointerdown', () => {
            this.tweens.add({
                targets: pokemon,
                scaleX: 0.9,
                scaleY: 0.9,
                duration: 100,
                yoyo: true,
                onComplete: () => {
                    // Emit custom event to React layer
                    this.events.emit('pokemonClicked')
                },
            })
        })

        // Add text label
        this.add.text(width / 2, height / 2 + 120, 'Click Me!', {
            fontSize: '24px',
            color: '#ffffff',
        }).setOrigin(0.5)

        console.log('MainScene: Game ready')
    }
}
