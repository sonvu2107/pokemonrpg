import Phaser from 'phaser'

export default class ExploreScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ExploreScene' })
    }

    preload() {
        console.log('ExploreScene: Preloading assets...')
        // Preload exploration assets here
    }

    create() {
        const { width, height } = this.cameras.main

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f3460)

        // Player character (placeholder circle)
        this.player = this.add.circle(width / 2, height / 2, 30, 0xfeca57)
        this.player.setStrokeStyle(2, 0xffffff)

        // Title
        this.add.text(width / 2, 30, 'Explore Scene', {
            fontSize: '24px',
            color: '#ffffff',
        }).setOrigin(0.5)

        // Instructions
        this.add.text(width / 2, height - 30, 'Use arrow keys to move', {
            fontSize: '16px',
            color: '#aaaaaa',
        }).setOrigin(0.5)

        // Setup keyboard input
        this.cursors = this.input.keyboard.createCursorKeys()

        // Movement speed
        this.moveSpeed = 3

        // Add some obstacles (placeholder rectangles)
        this.add.rectangle(width * 0.3, height * 0.4, 80, 80, 0x48dbfb)
        this.add.rectangle(width * 0.7, height * 0.6, 80, 80, 0xee5a6f)

        console.log('ExploreScene: Ready')
    }

    update() {
        // Simple movement with arrow keys
        if (this.cursors.left.isDown) {
            this.player.x -= this.moveSpeed
        } else if (this.cursors.right.isDown) {
            this.player.x += this.moveSpeed
        }

        if (this.cursors.up.isDown) {
            this.player.y -= this.moveSpeed
        } else if (this.cursors.down.isDown) {
            this.player.y += this.moveSpeed
        }

        // Keep player in bounds
        const { width, height } = this.cameras.main
        this.player.x = Phaser.Math.Clamp(this.player.x, 30, width - 30)
        this.player.y = Phaser.Math.Clamp(this.player.y, 30, height - 30)
    }
}
