import Phaser from 'phaser'

export default class BattleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BattleScene' })
        this.battleState = 'MENU' // MENU, SKILLS, ANIMATING
    }

    preload() {
        console.log('BattleScene: Preloading assets...')
    }

    create() {
        const { width, height } = this.cameras.main

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e)

        // Calculate layout positions
        const panelY = 150
        const menuY = height - 100

        // Player Pokemon Panel (Left)
        this.createPokemonPanel(50, panelY, 'Your Dragonite', 69, 100, 100, 0x9b59b6, true)

        // Enemy Pokemon Panel (Right)
        this.createPokemonPanel(width - 390, panelY, 'Wild Caterpie', 4, 100, 100, 0x27ae60, false)

        // Main Battle Menu (Fight, Item, etc)
        this.mainMenuContainer = this.add.container(0, 0)
        this.createMainMenu(width / 2, menuY)

        // Skills Menu (Initially hidden)
        this.skillsMenuContainer = this.add.container(0, 0)
        this.createSkillsMenu(width / 2, menuY)
        this.skillsMenuContainer.setVisible(false)

        // Message Log (Top Center)
        this.messageBox = this.add.text(width / 2, 50, 'What will Dragonite do?', {
            fontSize: '24px',
            color: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5)

        console.log('BattleScene: Turn-based battle ready')
    }

    createPokemonPanel(x, y, name, level, hpPercent, mpPercent, color, isPlayer) {
        const panelWidth = 340
        const panelHeight = 220

        // Panel background
        const panel = this.add.rectangle(x, y, panelWidth, panelHeight, 0x2c3e50, 0.9)
        panel.setStrokeStyle(2, 0xffffff)
        panel.setOrigin(0, 0)

        // Pokemon name
        this.add.text(x + 20, y + 20, name, {
            fontSize: '20px',
            color: '#ffffff',
            fontStyle: 'bold'
        })

        // Level
        this.add.text(x + panelWidth - 20, y + 20, `Lv.${level}`, {
            fontSize: '18px',
            color: '#f1c40f',
            fontStyle: 'bold'
        }).setOrigin(1, 0)

        // HP Bar
        this.add.text(x + 20, y + 60, `HP`, { fontSize: '16px', color: '#e74c3c', fontStyle: 'bold' })
        const hpBarBg = this.add.rectangle(x + 60, y + 62, 250, 18, 0x555555).setOrigin(0, 0)
        const hpBar = this.add.rectangle(x + 60, y + 62, 250 * (hpPercent / 100), 18, 0x2ecc71).setOrigin(0, 0)
        this.add.text(x + 185, y + 63, `${hpPercent}%`, { fontSize: '12px', color: '#fff' }).setOrigin(0.5, 0)

        // MP Bar
        this.add.text(x + 20, y + 90, `MP`, { fontSize: '16px', color: '#3498db', fontStyle: 'bold' })
        const mpBarBg = this.add.rectangle(x + 60, y + 92, 250, 18, 0x555555).setOrigin(0, 0)
        const mpBar = this.add.rectangle(x + 60, y + 92, 250 * (mpPercent / 100), 18, 0x3498db).setOrigin(0, 0)
        this.add.text(x + 185, y + 93, `${mpPercent}%`, { fontSize: '12px', color: '#fff' }).setOrigin(0.5, 0)

        // Pokemon sprite (placeholder circle)
        const sprite = this.add.circle(x + panelWidth / 2, y + 160, 50, color)
        sprite.setStrokeStyle(3, 0xffffff)

        return { panel, hpBar, mpBar, sprite }
    }

    createMainMenu(centerX, y) {
        const menuOptions = ['Fight', 'Item', 'Party', 'Run']
        const btnWidth = 140
        const btnHeight = 50
        const gap = 20
        const totalWidth = (btnWidth * menuOptions.length) + (gap * (menuOptions.length - 1))
        const startX = centerX - totalWidth / 2 + btnWidth / 2

        menuOptions.forEach((option, index) => {
            const btnX = startX + index * (btnWidth + gap)

            const btn = this.add.rectangle(btnX, y, btnWidth, btnHeight, 0xe74c3c)
            btn.setStrokeStyle(2, 0xffffff)
            btn.setInteractive({ useHandCursor: true })

            const text = this.add.text(btnX, y, option, {
                fontSize: '20px',
                color: '#ffffff',
                fontStyle: 'bold'
            }).setOrigin(0.5)

            // Hover
            btn.on('pointerover', () => {
                btn.setFillStyle(0xc0392b)
                this.tweens.add({ targets: btn, scaleX: 1.05, scaleY: 1.05, duration: 100 })
            })
            btn.on('pointerout', () => {
                btn.setFillStyle(0xe74c3c)
                this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 100 })
            })

            // Click
            btn.on('pointerdown', () => {
                this.handleMenuClick(option)
            })

            this.mainMenuContainer.add([btn, text])
        })
    }

    createSkillsMenu(centerX, centerY) {
        const menuWidth = 700
        const menuHeight = 180

        // Background panel for skills
        const bg = this.add.rectangle(centerX, centerY, menuWidth, menuHeight, 0x2c3e50, 0.95)
        bg.setStrokeStyle(2, 0x3498db)
        this.skillsMenuContainer.add(bg)

        // Back Button
        const backBtn = this.add.text(centerX + menuWidth / 2 - 20, centerY - menuHeight / 2 + 20, '✖ CANCEL', {
            fontSize: '14px',
            color: '#e74c3c',
            fontStyle: 'bold'
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })

        backBtn.on('pointerdown', () => this.showMainMenu())
        this.skillsMenuContainer.add(backBtn)

        // Skills Data
        const skills = [
            { name: 'Dragon Fang', type: 'DRAGON', mp: 4, damage: 50, color: 0x8e44ad },
            { name: 'Dragon Rush', type: 'DRAGON', mp: 6, damage: 65, color: 0x8e44ad },
            { name: 'Gust', type: 'FLYING', mp: 3, damage: 40, color: 0x3498db },
            { name: 'Windy Spin', type: 'FLYING', mp: 4, damage: 50, color: 0x3498db },
        ]

        const startX = centerX - 180
        const startY = centerY - 30

        skills.forEach((skill, index) => {
            const col = index % 2
            const row = Math.floor(index / 2)

            const btnX = startX + col * 360
            const btnY = startY + row * 60

            const btn = this.add.rectangle(btnX, btnY, 340, 50, 0x34495e)
            btn.setStrokeStyle(1, 0x7f8c8d)
            btn.setInteractive({ useHandCursor: true })

            // Type Badge
            const typeText = this.add.text(btnX - 160, btnY, skill.type, {
                fontSize: '12px',
                color: '#ffffff',
                backgroundColor: Phaser.Display.Color.IntegerToColor(skill.color).rgba,
                padding: { x: 5, y: 3 }
            }).setOrigin(0, 0.5)

            // Name
            const nameText = this.add.text(btnX - 80, btnY, skill.name, {
                fontSize: '18px',
                color: '#ffffff',
                fontStyle: 'bold'
            }).setOrigin(0, 0.5)

            // Stats
            const statText = this.add.text(btnX + 160, btnY, `${skill.mp} MP`, {
                fontSize: '14px',
                color: '#3498db',
                fontStyle: 'bold'
            }).setOrigin(1, 0.5)

            btn.on('pointerover', () => {
                btn.setFillStyle(0x2980b9)
            })
            btn.on('pointerout', () => {
                btn.setFillStyle(0x34495e)
            })
            btn.on('pointerdown', () => {
                this.useSkill(skill)
            })

            this.skillsMenuContainer.add([btn, typeText, nameText, statText])
        })
    }

    handleMenuClick(option) {
        if (this.battleState !== 'MENU') return

        if (option === 'Fight') {
            this.battleState = 'SKILLS'
            this.mainMenuContainer.setVisible(false)
            this.skillsMenuContainer.setVisible(true)
            this.messageBox.setText('Select a move!')
        } else {
            this.messageBox.setText(`You selected ${option}!`)
        }
    }

    showMainMenu() {
        this.battleState = 'MENU'
        this.skillsMenuContainer.setVisible(false)
        this.mainMenuContainer.setVisible(true)
        this.messageBox.setText('What will Dragonite do?')
    }

    useSkill(skill) {
        if (this.battleState !== 'SKILLS') return
        this.battleState = 'ANIMATING'

        this.skillsMenuContainer.setVisible(false)
        this.mainMenuContainer.setVisible(true) // Show menu background but disabled contextually

        this.messageBox.setText(`Dragonite used ${skill.name}!`)

        // Mock animation delay
        this.time.delayedCall(1500, () => {
            this.messageBox.setText(`It dealt ${skill.damage} damage!`)
            this.time.delayedCall(1000, () => {
                this.showMainMenu()
            })
        })
    }
}
