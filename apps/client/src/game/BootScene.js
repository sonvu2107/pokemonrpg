import Phaser from 'phaser'

export default class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' })
    }

    preload() {
        // Preload assets here
        // Example: this.load.image('pokemon', '/assets/pokemon.png')

        // For demo, we'll use simple graphics in MainScene
        console.log('BootScene: Preloading assets...')
    }

    create() {
        console.log('BootScene: Assets loaded, starting MainScene')
        this.scene.start('MainScene')
    }
}
