import sharp from 'sharp';

const input = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\f63f9daa-ef76-48a0-81b8-6df9109fb378\\pokeball_logo_1772500883735.png';

async function makeCircular(size, outputPath) {
    const roundedCorners = Buffer.from(
        `<svg><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" /></svg>`
    );

    await sharp(input)
        // Trim the white background to perfectly fit the circle
        .trim({ background: { r: 255, g: 255, b: 255, alpha: 1 }, threshold: 50 })
        .resize(size, size)
        .composite([{
            input: roundedCorners,
            blend: 'dest-in'
        }])
        .png()
        .toFile(outputPath);
}

async function resize() {
    await makeCircular(192, 'public/logo192.png');
    await makeCircular(512, 'public/logo512.png');
    await makeCircular(64, 'public/favicon.png');
    console.log('Images resized and saved in public/');
}

resize();
